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
  reward_points_value: number;
  referral_discount_applied: number;
  tax_breakdown: TaxBreakdownEntry[] | null;
  // Response-only, not a persisted column — set when the referred client's
  // welcome reward couldn't apply as an instant discount (bill below
  // min_bill_amount) and was credited to their eWallet instead.
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
  // Server-computed only — never trust a value sent by the frontend for this
  // (see payments.service.ts's Refer & Earn block).
  referral_discount_applied?: number;
  // Snapshot of the itemized tax breakdown (CGST/SGST/etc.) at the moment of
  // payment — computed on the frontend from the salon's active tax settings.
  // Persisted as-is so a reprinted receipt shows what was actually charged,
  // not today's tax settings if they've since changed.
  tax_breakdown?: TaxBreakdownEntry[];
};
