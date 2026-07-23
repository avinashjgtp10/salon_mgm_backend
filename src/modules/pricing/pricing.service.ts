import { computeBillTotals, rowsTotal, BucketAmounts, LineItem } from './pricing.engine';
import { getActiveTaxes } from '../settings/tax.util';
import { ewalletRepository } from '../ewallet/ewallet.repository';
import { rewardPointsRepository } from '../reward-points/reward-points.repository';
import { referralRepository } from '../referral/referral.repository';
import { clientMembershipsRepository } from '../client-memberships/client-memberships.repository';
import { clientsRepository } from '../clients/clients.repository';
import { paymentsRepository } from '../payments/payments.repository';
import { couponsService } from '../coupons/coupons.service';
import { AppError } from '../../middleware/error.middleware';
import { CalculateTotalsBody, CalculateTotalsResponse } from './pricing.types';

// Read-only mirror of AppointmentModal.tsx's membershipWalletMap allocation
// (service rows first, excluding package-covered ones, then product rows
// if the client's membership allows it) — NOT the same code path as
// payments.service.ts's deductWalletForBooking, which actually WRITES to
// membership_usage_log. This never touches the database: it only exists so
// the live preview can show the correct service/product split for tax
// purposes before checkout, without deducting anything. The real deduction
// still happens exactly once, at actual charge time, in payments.service.ts.
function splitMembershipWalletUsage(
  serviceRows: LineItem[],
  productRows: LineItem[],
  requestedAmount: number,
  coversProducts: boolean,
): { serviceWalletUsed: number; productWalletUsed: number; totalWalletUsed: number } {
  let remaining = Math.max(0, requestedAmount);
  let serviceWalletUsed = 0;
  let productWalletUsed = 0;

  for (const row of serviceRows) {
    if (row.isPackageService || remaining <= 0) continue;
    const rowTotal = row.total ?? row.price * (row.qty || 1);
    if (rowTotal <= 0) continue;
    const used = Math.min(remaining, rowTotal);
    remaining -= used;
    serviceWalletUsed += used;
  }

  if (coversProducts) {
    for (const row of productRows) {
      if (remaining <= 0) continue;
      const rowTotal = row.total ?? row.price * (row.qty || 1);
      if (rowTotal <= 0) continue;
      const used = Math.min(remaining, rowTotal);
      remaining -= used;
      productWalletUsed += used;
    }
  }

  return { serviceWalletUsed, productWalletUsed, totalWalletUsed: serviceWalletUsed + productWalletUsed };
}

// Per-row form of the same fill-in-order allocation splitMembershipWalletUsage
// does — returns how much wallet each individual row absorbed, so the per-row
// tax preview can exclude the wallet-covered portion of a row from its taxable
// base (same as checkout does via payments.service.ts's walletUsedByItem).
function allocateWalletPerRow(rows: LineItem[], totalWallet: number, skipPackageRows: boolean): number[] {
  let remaining = Math.max(0, totalWallet);
  return rows.map((row) => {
    if ((skipPackageRows && row.isPackageService) || remaining <= 0) return 0;
    const rowTotal = row.total ?? row.price * (row.qty || 1);
    if (rowTotal <= 0) return 0;
    const used = Math.min(remaining, rowTotal);
    remaining -= used;
    return used;
  });
}

export const pricingService = {
  async calculateTotals(salonId: string, body: CalculateTotalsBody): Promise<CalculateTotalsResponse> {
    const actualAmounts: BucketAmounts = {
      service: rowsTotal(body.serviceRows ?? []),
      packages: rowsTotal(body.packageRows ?? []),
      product: rowsTotal(body.productRows ?? []),
      membership: rowsTotal(body.membershipRows ?? []),
    };
    const rawSubtotal = actualAmounts.service + actualAmounts.packages + actualAmounts.product + actualAmounts.membership;

    // ── Coupon: validated server-side, never trust a pre-computed ₹ amount ──
    let couponDiscount = 0;
    let couponRejectedReason: string | undefined;
    if (body.couponCode) {
      try {
        const result = await couponsService.validate({ code: body.couponCode, orderAmount: rawSubtotal, salonId });
        couponDiscount = result.discountAmount;
      } catch (err: any) {
        couponRejectedReason = err instanceof AppError ? (err.code ?? err.message) : 'Could not validate coupon';
      }
    }

    // ── Sequential benefit preview ───────────────────────────────────────────
    // Membership wallet / eWallet / reward points / referral credit used to
    // each be previewed independently, capped only against their OWN balance
    // — never against how much of the bill was actually still left after the
    // others. That let the preview show a combined value that could vastly
    // exceed the bill (e.g. membership alone fully covers it, but eWallet and
    // reward points still showed as fully applied on top) — and since
    // payments.service.ts's real charge-time logic now caps sequentially too
    // (same order: Membership, eWallet, Reward Points, Referral), this preview
    // has to match or it would mislead staff about what's about to happen.
    // The ceiling here uses the same discount/tax/exCharges/tip as the real
    // grand total but without any wallet-coverage tax exclusion (that
    // exclusion only ever shifts the GST portion, not the whole bill, so this
    // is a safe, slightly conservative estimate) — recomputed exactly below
    // once every applied amount is known.
    const preliminaryTaxes = body.includeGst ? await getActiveTaxes(salonId).catch(() => []) : [];
    const preliminaryTotals = computeBillTotals({
      actualAmounts,
      discountType: body.discountType,
      discountValue: body.discountValue,
      couponDiscount,
      taxes: preliminaryTaxes,
      exCharges: body.exCharges ?? 0,
      tip: body.tip ?? 0,
      roundSubtotalBeforeDiscount: false,
    });
    let remaining = preliminaryTotals.grandTotal;

    // ── Membership wallet: read-only balance preview, no deduction ─────────
    // Mirrors payments.service.ts's own eligibility gate (applies_to_products)
    // and the frontend's row-by-row allocation, so the preview's service/
    // product split — and therefore the tax it implies — matches what
    // checkout will actually charge.
    let appliedMembershipWallet = 0;
    let membershipServiceWalletUsed = 0;
    let membershipProductWalletUsed = 0;
    if (body.applyMembershipWallet && body.client_id && remaining > 0) {
      try {
        const memberships = await clientMembershipsRepository.findAllActiveWithBalanceForClient(body.client_id, salonId);
        const totalBalance = memberships.reduce((s, m) => s + (Number(m.membershipWalletBalance) || 0), 0);
        const coversProducts = memberships.some((m) => m.appliesToProducts && Number(m.membershipWalletBalance) > 0);
        const requested = Math.min(body.membershipWalletRequested ?? totalBalance, totalBalance, remaining);
        const split = splitMembershipWalletUsage(body.serviceRows, body.productRows, requested, coversProducts);
        membershipServiceWalletUsed = split.serviceWalletUsed;
        membershipProductWalletUsed = split.productWalletUsed;
        appliedMembershipWallet = split.totalWalletUsed;
      } catch { /* non-fatal */ }
    }
    remaining = Math.max(0, remaining - appliedMembershipWallet);

    // ── eWallet: clamp requested amount to the client's real balance AND to
    // what's still left on the bill after membership wallet coverage above ──
    let appliedEWallet = 0;
    if (body.applyEwallet && body.client_id && (body.eWalletRequested ?? 0) > 0 && remaining > 0) {
      try {
        const balance = await ewalletRepository.getBalance(body.client_id);
        appliedEWallet = Math.min(body.eWalletRequested ?? 0, balance, remaining);
      } catch { /* non-fatal — treat as unavailable */ }
    }
    remaining = Math.max(0, remaining - appliedEWallet);

    // ── Reward points: clamp requested points to real balance, convert to ₹ ─
    let appliedRewardPointsValue = 0;
    if (body.applyRewardPoints && body.client_id && (body.rewardPointsToRedeem ?? 0) > 0 && remaining > 0) {
      try {
        const [rpConfig, rpBalance] = await Promise.all([
          rewardPointsRepository.getConfig(salonId),
          rewardPointsRepository.getBalance(body.client_id),
        ]);
        let pointsToRedeem = Math.min(body.rewardPointsToRedeem ?? 0, rpBalance);
        if (pointsToRedeem > 0 && rpConfig.redeem_points > 0) {
          let value = (pointsToRedeem / rpConfig.redeem_points) * rpConfig.redeem_value;
          if (value > remaining) {
            // Cap the ₹ value at what's left, then work backward to how many
            // points that actually costs — floor so this only ever slightly
            // UNDER-redeems in the preview, matching the real charge-time logic.
            pointsToRedeem = Math.floor((remaining / rpConfig.redeem_value) * rpConfig.redeem_points);
            value = (pointsToRedeem / rpConfig.redeem_points) * rpConfig.redeem_value;
          }
          appliedRewardPointsValue = value;
        }
      } catch { /* non-fatal */ }
    }
    remaining = Math.max(0, remaining - appliedRewardPointsValue);

    // ── Referral credit: clamp requested ₹ to real balance AND to what's
    // still left on the bill ─────────────────────────────────────────────────
    let appliedReferralCredit = 0;
    let referralCreditRejectedReason: string | undefined;
    if (body.applyReferralCredit) {
      if (!body.client_id) {
        referralCreditRejectedReason = 'No client selected';
      } else if ((body.referralCreditRequested ?? 0) > 0 && remaining > 0) {
        try {
          const balance = await referralRepository.getBalance(body.client_id);
          appliedReferralCredit = Math.min(body.referralCreditRequested ?? 0, balance, remaining);
        } catch { /* non-fatal */ }
      }
    }
    remaining = Math.max(0, remaining - appliedReferralCredit);

    // ── Referral first-bill discount eligibility preview — mirrors
    // payments.service.ts's charge-time logic exactly, but read-only (no
    // ledger writes, no markRefereeRewarded — those only happen at actual
    // payment time). Only applies on the first-ever payment for this
    // appointment, so an appointment_id with prior payments is disqualified.
    let referralDiscountPreview = 0;
    if (body.client_id) {
      try {
        const existingPaid = body.appointment_id
          ? await paymentsRepository.getTotalPaidForAppointment(body.appointment_id)
          : 0;
        if (existingPaid === 0) {
          const client = await clientsRepository.findById(body.client_id, salonId);
          if (client?.referred_by_client_id && !client.referral_referee_rewarded) {
            const refConfig = await referralRepository.getConfig(salonId);
            if (refConfig.active && refConfig.referee_reward_amount > 0 && rawSubtotal >= refConfig.min_bill_amount) {
              referralDiscountPreview = Math.min(refConfig.referee_reward_amount, rawSubtotal);
            }
          }
        }
      } catch { /* non-fatal — preview omits the hint rather than failing */ }
    }

    // ── Tax ──────────────────────────────────────────────────────────────────
    const taxes = body.includeGst ? await getActiveTaxes(salonId) : [];

    // Per-row wallet coverage (same fill-in-order split as the aggregates
    // above) so each row's tax preview excludes the wallet-covered portion,
    // matching what checkout will actually store per sale_item.
    const svcWalletPerRow = allocateWalletPerRow(body.serviceRows ?? [], membershipServiceWalletUsed, true);
    const prodWalletPerRow = allocateWalletPerRow(body.productRows ?? [], membershipProductWalletUsed, false);

    const result = computeBillTotals({
      actualAmounts,
      discountType: body.discountType,
      discountValue: body.discountValue,
      couponDiscount: couponDiscount + referralDiscountPreview,
      taxes,
      exCharges: body.exCharges ?? 0,
      tip: body.tip ?? 0,
      eWalletUsed: appliedEWallet,
      membershipWalletUsed: appliedMembershipWallet,
      membershipServiceWalletUsed,
      membershipProductWalletUsed,
      rewardPointsRedeemedValue: appliedRewardPointsValue,
      referralCreditUsed: appliedReferralCredit,
      // Frontend-matching rounding order (this is the new preview path, not
      // the legacy payments.service.ts call site) — see the doc comment on
      // this flag in pricing.engine.ts.
      roundSubtotalBeforeDiscount: false,
      rows: {
        service: (body.serviceRows ?? []).map((r, i) => ({ ...r, walletUsed: svcWalletPerRow[i] ?? 0 })),
        packages: body.packageRows ?? [],
        product: (body.productRows ?? []).map((r, i) => ({ ...r, walletUsed: prodWalletPerRow[i] ?? 0 })),
        membership: body.membershipRows ?? [],
      },
    });

    let alreadyAppliedThisAppointment: CalculateTotalsResponse['alreadyAppliedThisAppointment'];
    if (body.appointment_id) {
      try {
        const consumed = await paymentsRepository.getConsumedBenefitsForAppointment(body.appointment_id);
        alreadyAppliedThisAppointment = consumed;
      } catch { /* non-fatal — omit if lookup fails */ }
    }

    return {
      ...result,
      appliedEWallet,
      appliedMembershipWallet,
      appliedRewardPointsValue,
      appliedReferralCredit,
      referralDiscountPreview,
      couponRejectedReason,
      referralCreditRejectedReason,
      alreadyAppliedThisAppointment,
    };
  },
};
