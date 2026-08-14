import {
  computeBillTotals, rowsTotal, BucketAmounts, LineItem,
  allocateMembershipDiscount, round2,
} from './pricing.engine';
import { membershipsRepository } from '../memberships/memberships.repository';
import type { MembershipAppliesTo } from '../memberships/memberships.types';
import { getActiveTaxes } from '../settings/tax.util';
import { ewalletRepository } from '../ewallet/ewallet.repository';
import { rewardPointsRepository } from '../reward-points/reward-points.repository';
import { referralRepository } from '../referral/referral.repository';
import { clientMembershipsRepository, resolveCategoryRestriction } from '../client-memberships/client-memberships.repository';
import { clientsRepository } from '../clients/clients.repository';
import { paymentsRepository } from '../payments/payments.repository';
import { couponsService } from '../coupons/coupons.service';
import { AppError } from '../../middleware/error.middleware';
import { CalculateTotalsBody, CalculateTotalsResponse } from './pricing.types';

// Read-only mirror of AppointmentModal.tsx's membershipWalletMap allocation
// — NOT the same code path as payments.service.ts's deductWalletForBooking,
// which actually WRITES to membership_usage_log. This never touches the
// database: it only exists so the live preview can show the correct
// service/product split for tax purposes before checkout, without deducting
// anything. The real deduction still happens exactly once, at actual charge
// time, in payments.service.ts.
// Optional narrowing of appliesTo to specific categories — empty/null means
// unrestricted, preserving today's behavior for every plan that doesn't use
// this feature.
function matchesCategoryRestriction(row: LineItem, categoryIds: string[] | null): boolean {
  return !categoryIds?.length || (!!row.categoryId && categoryIds.includes(row.categoryId));
}

// Total ₹ value a bucket's rows are actually eligible to have the wallet
// applied against — same eligibility filter (package-covered services
// excluded, category restriction) used by the fill allocation below.
function eligibleWalletTotal(rows: LineItem[], skipPackageRows: boolean, categoryIds: string[] | null): number {
  return rows.reduce((sum, row) => {
    if (skipPackageRows && row.isPackageService) return sum;
    if (!matchesCategoryRestriction(row, categoryIds)) return sum;
    const rowTotal = row.total ?? row.price * (row.qty || 1);
    return rowTotal > 0 ? sum + rowTotal : sum;
  }, 0);
}

function splitMembershipWalletUsage(
  serviceRows: LineItem[],
  productRows: LineItem[],
  requestedAmount: number,
  coversServices: boolean,
  coversProducts: boolean,
  serviceCategoryIds: string[] | null = [],
  productCategoryIds: string[] | null = [],
): { serviceWalletUsed: number; productWalletUsed: number; totalWalletUsed: number } {
  const requested = Math.max(0, requestedAmount);
  const serviceEligible = coversServices ? eligibleWalletTotal(serviceRows, true, serviceCategoryIds) : 0;
  const productEligible = coversProducts ? eligibleWalletTotal(productRows, false, productCategoryIds) : 0;
  const combinedEligible = serviceEligible + productEligible;
  if (combinedEligible <= 0 || requested <= 0) {
    return { serviceWalletUsed: 0, productWalletUsed: 0, totalWalletUsed: 0 };
  }

  // Proportional split — the wallet covers the SAME percentage of both
  // service and product value, rather than fully draining one bucket before
  // touching the other. Used to be strict "services first" priority, which
  // could zero out a product's coverage entirely just because an unrelated
  // service also competed for the same shared balance (see
  // allocateMembershipDiscount for the matching rework on the discount side).
  // ratio is always exactly 1 when the balance covers everyone, same result
  // as before this rework for that common case.
  const ratio = Math.min(1, requested / combinedEligible);
  const serviceWalletUsed = round2(serviceEligible * ratio);
  const productWalletUsed = round2(productEligible * ratio);
  return { serviceWalletUsed, productWalletUsed, totalWalletUsed: round2(serviceWalletUsed + productWalletUsed) };
}

// Per-row form of the same fill-in-order allocation used within a single
// bucket — returns how much wallet each individual row absorbed, so the
// per-row tax preview can exclude the wallet-covered portion of a row from
// its taxable base (same as checkout does via payments.service.ts's
// walletUsedByItem). `totalWallet` here is that bucket's OWN proportional
// share from splitMembershipWalletUsage above (not the full requested
// amount), so within a bucket, earlier rows still fill first — only the
// cross-bucket (service vs product) split is proportional now.
function allocateWalletPerRow(
  rows: LineItem[], totalWallet: number, skipPackageRows: boolean,
  categoryIds: string[] | null = [],
): number[] {
  let remaining = Math.max(0, totalWallet);
  return rows.map((row) => {
    if ((skipPackageRows && row.isPackageService) || remaining <= 0) return 0;
    if (!matchesCategoryRestriction(row, categoryIds)) return 0;
    const rowTotal = row.total ?? row.price * (row.qty || 1);
    if (rowTotal <= 0) return 0;
    const used = Math.min(remaining, rowTotal);
    remaining -= used;
    return used;
  });
}

export interface MembershipDiscountPreview {
  total: number;
  /** Index-aligned with the serviceRows/productRows this was resolved against. */
  serviceDiscounts: number[];
  productDiscounts: number[];
}

// Resolves how much discount a client's percentage membership — or, failing
// that, an unlocked salon-wide loyalty plan — would grant on these rows, AND
// which specific rows it lands on. Read-only: the balance is only actually
// decremented at charge time, by payments.service.ts's applyMembershipDiscountForBooking
// — but both call the shared allocateMembershipDiscount so the two can never
// disagree about which rows got how much.
export async function resolveMembershipDiscount(
  salonId: string,
  clientId: string,
  serviceRows: LineItem[],
  productRows: LineItem[],
  applyPercentage: boolean,
  applyLoyalty: boolean,
): Promise<MembershipDiscountPreview> {
  const empty = (): MembershipDiscountPreview => ({
    total: 0,
    serviceDiscounts: serviceRows.map(() => 0),
    productDiscounts: productRows.map(() => 0),
  });

  // Service rows in order, then product rows — either zeroed out per the
  // plan's applies_to setting. Package-covered service rows are already ₹0 so
  // they fall out naturally (allocateMembershipDiscount skips non-positive
  // amounts). Combining into one ordered list mirrors the exact fill order
  // the real ledger-writing deduction uses, so a balance that runs out
  // mid-bill runs out at the identical row in both the preview and the charge.
  const allocate = (percent: number, balance: number, appliesTo: MembershipAppliesTo, categoryIds: string[]): MembershipDiscountPreview => {
    const inCategory = (r: LineItem) => !categoryIds.length || (!!r.categoryId && categoryIds.includes(r.categoryId));
    const serviceAmounts = appliesTo === 'products'
      ? serviceRows.map(() => 0)
      : serviceRows.map((r) => (r.isPackageService || !inCategory(r) ? 0 : (r.total ?? r.price * (r.qty || 1))));
    const productAmounts = appliesTo === 'services'
      ? productRows.map(() => 0)
      : productRows.map((r) => (!inCategory(r) ? 0 : (r.total ?? r.price * (r.qty || 1))));
    const { total, discounts } = allocateMembershipDiscount([...serviceAmounts, ...productAmounts], percent, balance);
    return {
      total,
      serviceDiscounts: discounts.slice(0, serviceRows.length),
      productDiscounts: discounts.slice(serviceRows.length),
    };
  };

  // Discount Balance and Loyalty are independently toggled by staff and
  // stack additively when both are on — see applyMembershipDiscountForBooking
  // (payments.service.ts) for the same contract at actual charge time. Each
  // source's % is computed off the SAME original line amount, not chained.
  // Independent lookups (different tables, neither reads the other's result)
  // — resolved in parallel when both are toggled on, instead of one after
  // the other.
  const [percentageMembership, loyalty] = await Promise.all([
    applyPercentage ? clientMembershipsRepository.findActivePercentageForClient(clientId, salonId) : Promise.resolve(null),
    applyLoyalty ? membershipsRepository.findLoyaltyEligibility(clientId, salonId) : Promise.resolve(null),
  ]);

  const previews: MembershipDiscountPreview[] = [];

  if (percentageMembership) {
    previews.push(allocate(
      percentageMembership.discountPercent ?? 0,
      percentageMembership.discountBalanceRemaining,
      percentageMembership.appliesTo,
      percentageMembership.categoryIds,
    ));
  }

  // Loyalty is uncapped once unlocked, so there is no balance to bound it.
  if (loyalty?.eligible) {
    previews.push(allocate(loyalty.discountPercent, Infinity, loyalty.appliesTo, loyalty.categoryIds));
  }

  if (!previews.length) return empty();
  if (previews.length === 1) return previews[0];

  return {
    total: previews.reduce((s, p) => s + p.total, 0),
    serviceDiscounts: serviceRows.map((_, i) => previews.reduce((s, p) => s + p.serviceDiscounts[i], 0)),
    productDiscounts: productRows.map((_, i) => previews.reduce((s, p) => s + p.productDiscounts[i], 0)),
  };
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
    // ── Membership discount (percentage / loyalty) ─────────────────────────
    // Unlike every benefit below, this is a PRE-TAX price reduction, so it has
    // to be resolved before the ceiling is computed — it changes the taxable
    // base and therefore the grand total the redemptions get capped against.
    // Membership discount and referral-eligibility below don't read each
    // other's output — resolved via Promise.all instead of two sequential
    // awaits, mirroring the reward-points block's existing Promise.all further
    // down in this same function.
    const zeroDiscountPreview = {
      total: 0,
      serviceDiscounts: (body.serviceRows ?? []).map(() => 0),
      productDiscounts: (body.productRows ?? []).map(() => 0),
    };
    const [membershipDiscountResult, referralDiscountPreview] = await Promise.all([
      (async () => {
        if (!((body.applyMembershipDiscount || body.applyLoyaltyDiscount) && body.client_id)) return zeroDiscountPreview;
        try {
          return await resolveMembershipDiscount(
            salonId, body.client_id, body.serviceRows ?? [], body.productRows ?? [],
            !!body.applyMembershipDiscount, !!body.applyLoyaltyDiscount,
          );
        } catch {
          return zeroDiscountPreview; // non-fatal — preview simply shows no discount
        }
      })(),
      // ── Referral first-bill discount eligibility preview — mirrors
      // payments.service.ts's charge-time logic exactly, but read-only (no
      // ledger writes, no markRefereeRewarded — those only happen at actual
      // payment time). Only applies on the first-ever payment for this
      // appointment, so an appointment_id with prior payments is disqualified.
      // Resolved here, before the preliminary ceiling call below, because it's
      // now part of the same waterfall the ceiling needs to already reflect
      // (Referral Discount is applied before Membership Wallet/eWallet/Reward
      // Points, per pricing.engine.ts's computeBillTotals).
      (async (): Promise<number> => {
        if (!body.client_id) return 0;
        try {
          const existingPaid = body.appointment_id
            ? await paymentsRepository.getTotalPaidForAppointment(body.appointment_id)
            : 0;
          if (existingPaid !== 0) return 0;
          const client = await clientsRepository.findById(body.client_id, salonId);
          if (!client?.referred_by_client_id || client.referral_referee_rewarded) return 0;
          const refConfig = await referralRepository.getConfig(salonId);
          if (refConfig.active && refConfig.referee_reward_amount > 0 && rawSubtotal >= refConfig.min_bill_amount) {
            return Math.min(refConfig.referee_reward_amount, rawSubtotal);
          }
          return 0;
        } catch {
          return 0; // non-fatal — preview omits the hint rather than failing
        }
      })(),
    ]);
    const appliedMembershipDiscount = membershipDiscountResult.total;
    const membershipServiceDiscounts = membershipDiscountResult.serviceDiscounts;
    const membershipProductDiscounts = membershipDiscountResult.productDiscounts;
    const membershipServiceDiscountUsed = membershipServiceDiscounts.reduce((s, v) => s + v, 0);
    const membershipProductDiscountUsed = membershipProductDiscounts.reduce((s, v) => s + v, 0);

    // Fetched once and reused for both the preliminary and final
    // computeBillTotals calls below — nothing in this request mutates tax
    // config in between, so a second identical getActiveTaxes(salonId) call
    // (previously right before the final computeBillTotals) was pure waste.
    const taxes = body.includeGst ? await getActiveTaxes(salonId).catch(() => []) : [];
    const preliminaryTotals = computeBillTotals({
      actualAmounts,
      discountType: body.discountType,
      discountValue: body.discountValue,
      discountAppliesTo: body.discountAppliesTo,
      couponDiscount,
      membershipDiscountAmount: appliedMembershipDiscount,
      membershipServiceDiscountUsed,
      membershipProductDiscountUsed,
      referralDiscount: referralDiscountPreview,
      taxes,
      exCharges: body.exCharges ?? 0,
      tip: body.tip ?? 0,
      roundSubtotalBeforeDiscount: false,
    });
    // Ceiling for the sequential Membership Wallet → eWallet → Reward Points →
    // Referral Credit capping below — rooted in the raw pre-redemption total,
    // NOT grandTotal (which now already has those redemptions subtracted and
    // would double-count if used as the ceiling here).
    let remaining = preliminaryTotals.preRedemptionTotal;

    // ── Membership wallet: read-only balance preview, no deduction ─────────
    // Mirrors payments.service.ts's own eligibility gate (applies_to) and the
    // frontend's row-by-row allocation, so the preview's service/product
    // split — and therefore the tax it implies — matches what checkout will
    // actually charge.
    let appliedMembershipWallet = 0;
    let membershipServiceWalletUsed = 0;
    let membershipProductWalletUsed = 0;
    let membershipServiceCategoryIds: string[] | null = [];
    let membershipProductCategoryIds: string[] | null = [];
    if (body.applyMembershipWallet && body.client_id && remaining > 0) {
      try {
        const memberships = await clientMembershipsRepository.findAllActiveWithBalanceForClient(body.client_id, salonId);
        const totalBalance = memberships.reduce((s, m) => s + (Number(m.membershipWalletBalance) || 0), 0);
        const withBalance = memberships.filter((m) => Number(m.membershipWalletBalance) > 0);
        const coversServices = withBalance.some((m) => m.appliesTo !== 'products');
        const coversProducts = withBalance.some((m) => m.appliesTo !== 'services');
        membershipServiceCategoryIds = coversServices ? resolveCategoryRestriction(withBalance, 'service') : [];
        membershipProductCategoryIds = coversProducts ? resolveCategoryRestriction(withBalance, 'product') : [];
        const requested = Math.min(body.membershipWalletRequested ?? totalBalance, totalBalance, remaining);
        const split = splitMembershipWalletUsage(
          body.serviceRows, body.productRows, requested, coversServices, coversProducts,
          membershipServiceCategoryIds, membershipProductCategoryIds,
        );
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

    // ── Tax ──────────────────────────────────────────────────────────────────
    // (already fetched once above, before the preliminary totals — reused here)

    // Per-row wallet coverage (same fill-in-order split as the aggregates
    // above) so each row's tax preview excludes the wallet-covered portion,
    // matching what checkout will actually store per sale_item.
    const svcWalletPerRow = allocateWalletPerRow(body.serviceRows ?? [], membershipServiceWalletUsed, true, membershipServiceCategoryIds);
    const prodWalletPerRow = allocateWalletPerRow(body.productRows ?? [], membershipProductWalletUsed, false, membershipProductCategoryIds);

    const result = computeBillTotals({
      actualAmounts,
      discountType: body.discountType,
      discountValue: body.discountValue,
      discountAppliesTo: body.discountAppliesTo,
      couponDiscount,
      membershipDiscountAmount: appliedMembershipDiscount,
      membershipServiceDiscountUsed,
      membershipProductDiscountUsed,
      referralDiscount: referralDiscountPreview,
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
        service: (body.serviceRows ?? []).map((r, i) => ({
          ...r, walletUsed: svcWalletPerRow[i] ?? 0, membershipDiscountUsed: membershipServiceDiscounts[i] ?? 0,
        })),
        packages: body.packageRows ?? [],
        product: (body.productRows ?? []).map((r, i) => ({
          ...r, walletUsed: prodWalletPerRow[i] ?? 0, membershipDiscountUsed: membershipProductDiscounts[i] ?? 0,
        })),
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
      rowMembershipDiscount: { service: membershipServiceDiscounts, product: membershipProductDiscounts },
      // Per-row membership WALLET coverage — same fill-in-order split
      // (services first, then products) already baked into rowTax above,
      // exposed separately so the UI can show a row's own wallet-covered
      // amount instead of re-deriving the fill order client-side, which can
      // silently disagree with this authoritative split (e.g. showing a
      // product still "fully covered" after an added service row actually
      // took over that wallet share server-side — see AppointmentModal.tsx's
      // membershipWalletMap).
      rowMembershipWallet: { service: svcWalletPerRow, product: prodWalletPerRow },
      appliedEWallet,
      appliedMembershipWallet,
      appliedRewardPointsValue,
      appliedReferralCredit,
      appliedMembershipDiscount,
      referralDiscountPreview,
      couponRejectedReason,
      referralCreditRejectedReason,
      alreadyAppliedThisAppointment,
    };
  },
};
