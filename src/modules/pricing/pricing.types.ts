import type { LineItem } from './pricing.engine';

export interface CalculateTotalsBody {
  client_id?: string;
  // When editing an already-saved, partially-paid appointment — lets the
  // engine surface how much of the eWallet/points/referral/membership-wallet
  // usage shown is already locked in from a prior payment on this same
  // booking, rather than being freshly available. See
  // payments.repository.ts::getConsumedBenefitsForAppointment.
  appointment_id?: string;

  serviceRows: LineItem[];
  packageRows: LineItem[];
  productRows: LineItem[];
  membershipRows: LineItem[];

  discountType: 'percentage' | 'flat';
  discountValue: number;

  couponCode?: string;

  exCharges: number;
  tip: number;
  // Per-transaction "no GST this time" override — when false, tax is zero for
  // this bill only; does not touch salon-wide tax settings.
  includeGst: boolean;

  applyEwallet?: boolean;
  eWalletRequested?: number;

  applyMembershipWallet?: boolean;
  // Requested amount to apply — never trusted as-is, always clamped
  // server-side to the client's real combined membership-wallet balance
  // (pricing.service.ts). Omit to default to the full available balance.
  membershipWalletRequested?: number;

  // Percentage/loyalty membership discount. Intent only — there is no requested
  // amount because the figure is fully determined by the plan's percentage, the
  // eligible line total, and whatever discount balance is left.
  applyMembershipDiscount?: boolean;

  applyRewardPoints?: boolean;
  rewardPointsToRedeem?: number;

  applyReferralCredit?: boolean;
  referralCreditRequested?: number;
}

export interface CalculateTotalsResponse {
  catalogTotal: number;
  itemDiscountTotal: number;
  subtotal: number;
  manualDiscount: number;
  totalDisc: number;
  taxable: number;
  gstAmount: number;
  taxBreakdown: { name: string; rate: number; amount: number; inclusive: boolean }[];
  grandTotal: number;
  roundOff: number;
  effectiveTotal: number;

  // Per-row GST + taxable base, index-aligned with the serviceRows/packageRows/
  // productRows/membershipRows the caller sent — lets the live sale-building
  // screen show each item's own tax before checkout, matching what the saved
  // sale_items will carry. See pricing.engine.ts's per-row allocation.
  rowTax?: { service: number[]; packages: number[]; product: number[]; membership: number[] };
  rowTaxableAmount?: { service: number[]; packages: number[]; product: number[]; membership: number[] };

  // Per-row membership discount (Discount Balance/Loyalty), index-aligned
  // with serviceRows/productRows — same fill-in-order split already folded
  // into rowTax above, exposed separately so the UI can show "-₹X Membership"
  // against the row it actually reduced instead of only a bill-level total.
  rowMembershipDiscount?: { service: number[]; product: number[] };

  // Server-clamped amounts actually applied — authoritative, may be lower
  // than what was requested (real balance, coupon rejected, etc).
  appliedEWallet: number;
  appliedMembershipWallet: number;
  appliedRewardPointsValue: number;
  appliedReferralCredit: number;
  // Pre-tax discount actually granted by a percentage/loyalty membership —
  // already reflected inside totalDisc/taxable/grandTotal above, unlike the
  // applied* redemptions which are only subtracted in effectiveTotal.
  appliedMembershipDiscount: number;

  // Referral first-bill-discount eligibility preview (payments.service.ts
  // already computes this server-side at charge time — exposed here so the
  // frontend stops locally guessing at it).
  referralDiscountPreview: number;

  // Non-fatal per-field rejection reasons — the field itself is zeroed out
  // in the totals above rather than failing the whole request.
  couponRejectedReason?: string;
  referralCreditRejectedReason?: string;

  // Informational only — amounts already consumed by prior payments on
  // appointment_id (if provided), not subtracted from the applied* fields
  // above (those are already correct against current real balances).
  alreadyAppliedThisAppointment?: {
    ewalletUsed: number;
    membershipWalletUsed: number;
    rewardPointsUsed: number;
    referralCreditUsed: number;
  };
}
