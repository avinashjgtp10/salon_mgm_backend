import { computeBillTotals, rowsTotal, BucketAmounts } from './pricing.engine';
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

    // ── eWallet: clamp requested amount to the client's real balance ────────
    let appliedEWallet = 0;
    if (body.applyEwallet && body.client_id && (body.eWalletRequested ?? 0) > 0) {
      try {
        const balance = await ewalletRepository.getBalance(body.client_id);
        appliedEWallet = Math.min(body.eWalletRequested ?? 0, balance);
      } catch { /* non-fatal — treat as unavailable */ }
    }

    // ── Membership wallet: read-only balance preview, no deduction ─────────
    let appliedMembershipWallet = 0;
    if (body.applyMembershipWallet && body.client_id) {
      try {
        const memberships = await clientMembershipsRepository.findAllActiveWithBalanceForClient(body.client_id, salonId);
        appliedMembershipWallet = memberships.reduce((s, m) => s + (Number(m.membershipWalletBalance) || 0), 0);
      } catch { /* non-fatal */ }
    }

    // ── Reward points: clamp requested points to real balance, convert to ₹ ─
    let appliedRewardPointsValue = 0;
    if (body.applyRewardPoints && body.client_id && (body.rewardPointsToRedeem ?? 0) > 0) {
      try {
        const [rpConfig, rpBalance] = await Promise.all([
          rewardPointsRepository.getConfig(salonId),
          rewardPointsRepository.getBalance(body.client_id),
        ]);
        const pointsToRedeem = Math.min(body.rewardPointsToRedeem ?? 0, rpBalance);
        if (pointsToRedeem > 0 && rpConfig.redeem_points > 0) {
          appliedRewardPointsValue = (pointsToRedeem / rpConfig.redeem_points) * rpConfig.redeem_value;
        }
      } catch { /* non-fatal */ }
    }

    // ── Referral credit: clamp requested ₹ to real balance ───────────────────
    let appliedReferralCredit = 0;
    let referralCreditRejectedReason: string | undefined;
    if (body.applyReferralCredit) {
      if (!body.client_id) {
        referralCreditRejectedReason = 'No client selected';
      } else if ((body.referralCreditRequested ?? 0) > 0) {
        try {
          const balance = await referralRepository.getBalance(body.client_id);
          appliedReferralCredit = Math.min(body.referralCreditRequested ?? 0, balance);
        } catch { /* non-fatal */ }
      }
    }

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
      rewardPointsRedeemedValue: appliedRewardPointsValue,
      referralCreditUsed: appliedReferralCredit,
      // Frontend-matching rounding order (this is the new preview path, not
      // the legacy payments.service.ts call site) — see the doc comment on
      // this flag in pricing.engine.ts.
      roundSubtotalBeforeDiscount: false,
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
