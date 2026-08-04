import type { MembershipAppliesTo } from "../memberships/memberships.types";

export interface ClientMembership {
  id: string;
  salonId: string;
  clientId: string;
  clientName: string;
  mobile?: string;
  email?: string;
  membershipId: string;
  membershipName: string;
  colour?: string;
  totalSessions: number;    // 0 = unlimited
  usedSessions: number;
  remainingSessions: number;
  purchasedAt: string;
  expiresAt?: string;
  status: 'active' | 'expired' | 'exhausted' | 'cancelled';
  pricePaid?: number;
  membershipWalletBalance: number;
  /** Denormalized from the plan at purchase time — see memberships.types.ts. */
  appliesTo: MembershipAppliesTo;
  /** Optional narrowing of appliesTo to specific categories — empty means unrestricted. */
  categoryIds: string[];
  /** Denormalized plain-text description from the plan at purchase time — see memberships.types.ts. */
  description?: string;
  pricingType: 'value' | 'percentage' | 'loyalty';
  discountPercent?: number;
  /** 'percentage' only — discount still available to hand out, depletes by discount given. */
  discountBalanceRemaining: number;
  usageLog?: UsageLogEntry[];
  // Set only when this row was auto-created as a byproduct of paying an
  // appointment that had this membership as a line item — that value is
  // already counted in the appointment's own total, so client-revenue
  // aggregation (useClientDetails.ts) must skip any row with this set to
  // avoid double-counting. NULL/undefined means a genuine standalone sale.
  appointmentId?: string | null;
  // Staff who sold the membership, and the sales row recordTransaction()
  // (or the checkout that bundled this membership) created for it — for
  // invoice_no lookup. NULL on rows sold before these columns existed.
  staffId?: string | null;
  saleId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageLogEntry {
  id: string;
  clientMembershipId: string;
  appointmentId?: string;
  serviceName?: string;
  sessionsConsumed: number;
  notes?: string;
  usedAt: string;
  amountDeducted?: number;
  remainingBalance?: number;
  serviceId?: string;
  clientId?: string;
  membershipId?: string;
}

export interface CreateClientMembershipDTO {
  clientId: string;
  membershipId: string;
  membershipName: string;
  colour?: string;
  totalSessions: number;
  expiresAt?: string;
  pricePaid?: number;
  notes?: string;
  // Optional here since clientMembershipsRepository.create() is also called
  // internally (autoCreateFromPayment, when a membership is one line item
  // within a larger appointment payment) where the sale/payment recording
  // already happened elsewhere — only clientMembershipsService.purchase()
  // (the direct "sell membership" flow) actually requires this.
  paymentMethod?: string;
  /** Method -> amount breakdown, present only when paymentMethod is a split combo. */
  splitDetails?: Record<string, number>;
  /** Set only by autoCreateFromPayment — the appointment this membership was sold within. */
  appointmentId?: string | null;
  /** Staff member who sold this membership — feeds client_memberships.staff_id and the sales/sale_items rows recordTransaction() creates. */
  staffId?: string;
}

export interface ConsumeSessionDTO {
  appointmentId?: string;
  serviceName?: string;
  sessionsToConsume?: number;
  notes?: string;
}

export interface WalletDeductionServiceInput {
  serviceId?: string;
  serviceName?: string;
  amount: number;
}

export interface WalletDeductionResult {
  totalWalletUsed: number;
  remainingBalance: number;
  perService: Array<{ serviceId?: string; walletUsed: number; customerPays: number }>;
  reused: boolean;
}

export interface DiscountDeductionServiceInput {
  serviceId?: string;
  serviceName?: string;
  /** Pre-discount line amount the percentage is applied to. */
  amount: number;
}

export interface DiscountDeductionResult {
  totalDiscountGiven: number;
  remainingBalance: number;
  perService: Array<{ serviceId?: string; discountGiven: number }>;
  reused: boolean;
}

export interface ClientMembershipsListQuery {
  clientId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ── DB row types ──────────────────────────────────────────────────────────────
export interface ClientMembershipRow {
  id: string;
  salon_id: string;
  client_id: string;
  client_name: string;
  mobile?: string | null;
  email?: string | null;
  membership_id: string;
  membership_name: string;
  colour?: string | null;
  total_sessions: number;
  used_sessions: number;
  purchased_at: string;
  expires_at?: string | null;
  status: string;
  price_paid?: string | null;
  membership_wallet_balance?: string | number | null;
  applies_to?: MembershipAppliesTo | null;
  category_ids?: string[] | null;
  description?: string | null;
  pricing_type?: string | null;
  discount_percent?: string | number | null;
  discount_balance_remaining?: string | number | null;
  appointment_id?: string | null;
  staff_id?: string | null;
  sale_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageLogRow {
  id: string;
  client_membership_id: string;
  appointment_id?: string | null;
  service_name?: string | null;
  sessions_consumed: number;
  notes?: string | null;
  used_at: string;
  amount_deducted?: string | number | null;
  remaining_balance?: string | number | null;
  service_id?: string | null;
  client_id?: string | null;
  membership_id?: string | null;
}
