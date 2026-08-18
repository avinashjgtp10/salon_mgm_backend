import type { Sale, SaleItem, SaleItemType } from "../sales/sales.types";

export type TransactionOrigin =
  | "calendar_checkout"
  | "quick_sell"
  | "package_purchase"
  | "membership_purchase";

export interface TransactionItemInput {
  item_type: SaleItemType;
  item_id?: string;
  staff_id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  /** This item's own GST, computed by pricing.engine.ts's per-row allocation (see rowTax on BillTotalsResult) — distinct from the whole sale's tax_amount below. */
  tax_amount?: number;
  /** This item's own post-discount/post-wallet base that tax_amount was computed on. */
  taxable_amount?: number;
}

export interface RecordTransactionInput {
  salon_id: string;
  client_id?: string;
  appointment_id?: string;
  staff_id?: string;
  origin: TransactionOrigin;
  items: TransactionItemInput[];
  /** Raw, as captured from the UI — normalization happens inside recordTransaction, not by the caller. */
  payment_label: string;
  /** Method -> amount, when the payment was split across more than one method. */
  split_details?: Record<string, number>;
  /**
   * ₹ of this transaction actually offset by an already-purchased Package's
   * sessions / a Membership's wallet+discount benefit — computed by the
   * caller from real catalog/ledger amounts, never from the frontend's own
   * payment_label. Folded into payment_method/payment_reference by
   * normalizePaymentMethod() so reports show "Package"/"Membership"/
   * "Package + Cash" instead of silently mislabeling these as wallet/cash.
   */
  source_amounts?: { package?: number; membership?: number };
  discount_amount?: number;
  /** Must be pre-computed by the caller — tax rules differ enough by origin that this function does not recompute it. */
  tax_amount?: number;
  /** Passes through to staff, not the salon — stored but excluded from
   *  sales.total_amount (revenue) unless tip_added_to_salon is set. */
  tip_amount?: number;
  /** "Add Tip to Salon" checkbox — checked: tip_amount counts toward
   *  sales.total_amount (revenue), same as ex_charges. Unchecked (default):
   *  tip_amount stays excluded, same as it's always behaved. */
  tip_added_to_salon?: boolean;
  /** A client-facing surcharge the business keeps — unlike tip_amount, this DOES count as revenue. */
  ex_charges?: number;
  coupon_code?: string;
  discount_percent?: number;
  discount_type?: string;
  /** Bill-level "Service/Bill Discount" alone, excluding coupon/referral/membership. */
  manual_discount_amount?: number;
  /** Real coupons.id, resolved server-side by looking up coupon_code — never trusted from the frontend. */
  coupon_id?: string;
  coupon_discount_amount?: number;
  coupon_discount_type?: string;
  referral_discount_amount?: number;
  /** The referring client's id (clients.id), when referral_discount_amount > 0. */
  referral_id?: string;
  referral_source?: string;
  notes?: string;
  created_at?: string;
  created_by?: string | null;
}

export interface RecordTransactionResult {
  sale: Sale;
  items: SaleItem[];
  /** True if an existing sale for this appointment_id was found and reused instead of creating a new one. */
  wasIdempotentReuse: boolean;
}

export class SaleRecordFailedError extends Error {
  constructor(public readonly origin: TransactionOrigin, public readonly cause: unknown) {
    super(`[SALE_RECORD_FAILED] Failed to record transaction for origin=${origin}: ${(cause as any)?.message ?? cause}`);
    this.name = "SaleRecordFailedError";
  }
}

export class UnrecognizedPaymentMethodError extends Error {
  constructor(public readonly label: string) {
    super(`[UNRECOGNIZED_PAYMENT_METHOD] Cannot record a transaction with unrecognized payment label: "${label}"`);
    this.name = "UnrecognizedPaymentMethodError";
  }
}
