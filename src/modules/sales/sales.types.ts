export type SaleStatus = "draft" | "completed" | "cancelled" | "refunded";
export type PaymentMethod = "cash" | "card" | "gift_card" | "split" | "upi" | "wallet" | "package" | "membership";
export type SaleItemType = "service" | "product" | "membership" | "gift_card" | "quick" | "package";

// Per-staff share of tip_amount — purely an attribution record ("who
// actually got what") alongside the existing lump tip_amount column, which
// stays the source of truth for bill math (pricing.engine.ts, receipts,
// sales.total_amount) and is expected to equal the sum of these entries.
// Optional/empty when the tip wasn't split (single-staff sale, or staff just
// used the plain Tip field) — nothing downstream requires it.
export type TipBreakdownEntry = {
    staff_id: string;
    staff_name: string;
    amount: number;
};

export type Sale = {
    id: string;
    salon_id: string;
    client_id: string | null;
    appointment_id: string | null;
    staff_id: string | null;
    status: SaleStatus;
    subtotal: string;
    discount_amount: string;
    // Passes through to staff, not the salon — tracked here but excluded
    // from total_amount unless tip_added_to_salon is set (see
    // salesRepository.create()).
    tip_amount: string;
    // "Add Tip to Salon" checkbox state this sale was recorded under.
    tip_added_to_salon: boolean;
    // Optional per-staff split of tip_amount — see TipBreakdownEntry.
    tip_breakdown: TipBreakdownEntry[] | null;
    tax_amount: string;
    // Counts as revenue — included in total_amount, unlike tip_amount.
    ex_charges: string;
    total_amount: string;
    payment_method: PaymentMethod | null;
    payment_reference: string | null;
    notes: string | null;
    invoice_number: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    coupon_code: string | null;
    discount_percent: string | null;
    discount_type: string | null;
    // ── Discount breakdown — each source's own ₹, distinct from the combined
    // discount_amount above (manual+coupon+referral+membership all merged,
    // used only for revenue netting). Lets Sale Details/reports/receipts show
    // "Service Discount"/"Coupon Discount"/"Referral Discount" as separate
    // lines instead of one opaque figure. ──────────────────────────────────
    manual_discount_amount: string;
    coupon_id: string | null;
    coupon_discount_amount: string;
    coupon_discount_type: string | null;
    referral_discount_amount: string;
    referral_id: string | null;
    referral_source: string | null;
};

export type SaleItem = {
    id: string;
    sale_id: string;
    item_type: SaleItemType;
    item_id: string | null;
    staff_id: string | null;
    name: string;
    quantity: number;
    unit_price: string;
    discount_amount: string;
    total_price: string;
    // This item's own GST + the post-discount/post-wallet base it was
    // computed on (see pricing.engine.ts's per-row allocation) — distinct
    // from the whole sale's Sale.tax_amount above. Defaults to '0' for every
    // sale_items row created before this column existed.
    tax_amount: string;
    taxable_amount: string;
    created_at: string;
};

export type CreateSaleBody = {
    salon_id: string; // injected from JWT in controller, not accepted from frontend body
    client_id?: string;
    appointment_id?: string;
    staff_id?: string;
    status?: SaleStatus;
    discount_amount?: string;
    tip_amount?: string;
    tip_added_to_salon?: boolean;
    tip_breakdown?: TipBreakdownEntry[] | null;
    tax_amount?: string;
    ex_charges?: string;
    payment_method?: PaymentMethod;
    payment_reference?: string;
    notes?: string;
    created_at?: string;
    coupon_code?: string;
    discount_percent?: string;
    discount_type?: string;
    manual_discount_amount?: string;
    coupon_id?: string;
    coupon_discount_amount?: string;
    coupon_discount_type?: string;
    referral_discount_amount?: string;
    referral_id?: string;
    referral_source?: string;
    items: Array<{
        item_type: SaleItemType;
        item_id?: string;
        staff_id?: string;
        name: string;
        quantity: number;
        unit_price: string;
        discount_amount?: string;
        tax_amount?: string;
        taxable_amount?: string;
    }>;
};

export type UpdateSaleBody = Partial<Omit<CreateSaleBody, "salon_id">>;

export type CheckoutSaleBody = {
    payment_method: PaymentMethod;
    amount_paid: number;
    payment_reference?: string;
    status?: "completed";
};
