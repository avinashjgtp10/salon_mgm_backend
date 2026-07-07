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
  tax_breakdown: TaxBreakdownEntry[] | null;
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
  reward_points_redeemed?: number;
  reward_points_value?: number;
  // Snapshot of the itemized tax breakdown (CGST/SGST/etc.) at the moment of
  // payment — computed on the frontend from the salon's active tax settings.
  // Persisted as-is so a reprinted receipt shows what was actually charged,
  // not today's tax settings if they've since changed.
  tax_breakdown?: TaxBreakdownEntry[];
};
