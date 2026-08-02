export type PaymentStatus = 'pending' | 'partial' | 'completed' | 'failed' | 'refunded';

export type TaxBreakdownEntry = {
  name: string;
  rate: number;
  amount: number;
  inclusive: boolean;
};

export type Payment = {
  id: string;
  appointment_id: string | null;
  salon_id: string;
  client_id: string | null;
  gross_amount: number;
  discount_amount: number;
  ewallet_used: number;
  net_amount: number;
  paid_amount: number;
  due_amount: number;
  coupon_code: string | null;
  payment_method: string;
  split_details: Record<string, number> | null;
  status: PaymentStatus;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  membership_wallet_used: number;
  membership_discount_used: number;
  reward_points_value: number;
  referral_discount_applied: number;
  tax_breakdown: TaxBreakdownEntry[] | null;
  // Redemption amounts actually applied to this payment — server-computed,
  // capped against the client's real reward-points/referral balances.
  reward_points_used: number;
  referral_credit_used: number;
  // Response-only, not a persisted column — set when the referred client's
  // welcome reward couldn't apply as an instant discount (bill below
  // min_bill_amount) and was credited to their referral balance instead.
  referral_wallet_credited?: number;
};

export type CreatePaymentBody = {
  appointment_id?: string;
  salon_id: string;
  client_id?: string;
  gross_amount: number;
  discount_amount?: number;
  ewallet_used?: number;
  net_amount: number;
  paid_amount?: number;
  due_amount?: number;
  coupon_code?: string;
  payment_method: string;
  split_details?: Record<string, number>;
  status?: PaymentStatus;
  notes?: string;
  membership_items?: Array<{ membership_id?: string; name: string; price: number; quantity: number }>;
  membership_wallet_used?: number;
  apply_membership_wallet?: boolean;
  // Staff-chosen cap on how much of the membership wallet to actually use —
  // never trusted as an amount to blindly deduct, only as an upper bound;
  // deductWalletForBooking still caps further by real balance/eligible items.
  // Omitted/undefined preserves the old "use as much as needed" behavior.
  membership_wallet_requested?: number;
  // Intent flag for a percentage/loyalty membership discount. There is no
  // matching "requested" field — the amount follows entirely from the plan's
  // percentage, the eligible line total, and the remaining discount balance.
  apply_membership_discount?: boolean;
  // Independent sibling flag for the salon-wide Loyalty discount — staff can
  // check this alongside (or instead of) apply_membership_discount above;
  // when both are checked their discounts stack additively (each computed
  // off the pre-discount line amount), see applyMembershipDiscountForBooking.
  apply_loyalty_discount?: boolean;
  // Server-computed only — never trust a value sent by the frontend.
  membership_discount_used?: number;
  // Server-computed only — never trust a value sent by the frontend for this
  // (see payments.service.ts's Refer & Earn block).
  referral_discount_applied?: number;
  // Server-computed only — the ₹ value of reward_points_used, converted via
  // the salon's redeem rate (payments.service.ts). Never trust a value sent
  // by the frontend for this.
  reward_points_value?: number;
  // Requested points/₹ to redeem — never trusted as-is, always capped
  // server-side against the client's real balance (payments.service.ts).
  reward_points_used?: number;
  referral_credit_used?: number;
  // Snapshot of the itemized tax breakdown (CGST/SGST/etc.) at the moment of
  // payment — computed on the frontend from the salon's active tax settings.
  // Persisted as-is so a reprinted receipt shows what was actually charged,
  // not today's tax settings if they've since changed.
  tax_breakdown?: TaxBreakdownEntry[];
  // Whether staff had "Include GST in this bill" checked for THIS payment.
  // Defaults to true (apply the salon's active tax config, the pre-existing
  // behavior) when omitted — only an explicit `false` skips tax entirely.
  // Without this, a client who paid the full GST-excluded total shown on
  // screen would still get billed for GST server-side, leaving a phantom
  // GST-sized due_amount and a wrongly-"Partial" status.
  include_gst?: boolean;
};
