export type SaleStatus = "draft" | "completed" | "cancelled" | "refunded";
export type PaymentMethod = "cash" | "card" | "gift_card" | "split" | "upi" | "wallet";
export type SaleItemType = "service" | "product" | "membership" | "gift_card" | "quick" | "package";

export type Sale = {
    id: string;
    salon_id: string;
    client_id: string | null;
    appointment_id: string | null;
    staff_id: string | null;
    status: SaleStatus;
    subtotal: string;
    discount_amount: string;
    // Passes through to staff, not the salon — tracked here but deliberately
    // excluded from total_amount (see salesRepository.create()).
    tip_amount: string;
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
    tax_amount?: string;
    ex_charges?: string;
    payment_method?: PaymentMethod;
    payment_reference?: string;
    notes?: string;
    created_at?: string;
    coupon_code?: string;
    discount_percent?: string;
    discount_type?: string;
    items: Array<{
        item_type: SaleItemType;
        item_id?: string;
        staff_id?: string;
        name: string;
        quantity: number;
        unit_price: string;
        discount_amount?: string;
    }>;
};

export type UpdateSaleBody = Partial<Omit<CreateSaleBody, "salon_id">>;

export type CheckoutSaleBody = {
    payment_method: PaymentMethod;
    amount_paid: number;
    payment_reference?: string;
    status?: "completed";
};
