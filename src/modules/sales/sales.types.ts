export type SaleStatus = "draft" | "completed" | "cancelled" | "refunded";
export type PaymentMethod = "cash" | "card" | "gift_card" | "split" | "upi";
export type SaleItemType = "service" | "product" | "membership" | "gift_card";

export type Sale = {
    id: string;
    salon_id: string;
    client_id: string | null;
    appointment_id: string | null;
    staff_id: string | null;
    status: SaleStatus;
    subtotal: string;
    discount_amount: string;
    tip_amount: string;
    tax_amount: string;
    total_amount: string;
    payment_method: PaymentMethod | null;
    payment_reference: string | null;
    notes: string | null;
    invoice_number: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type SaleItem = {
    id: string;
    sale_id: string;
    item_type: SaleItemType;
    item_id: string | null;
    name: string;
    quantity: number;
    unit_price: string;
    subtotal: string;
};

export type CreateSaleBody = {
    salon_id: string;
    client_id?: string;
    appointment_id?: string;
    staff_id?: string;
    status?: SaleStatus;
    discount_amount?: string;
    tip_amount?: string;
    tax_amount?: string;
    payment_method?: PaymentMethod;
    payment_reference?: string;
    notes?: string;
    items: Array<{
        item_type: SaleItemType;
        item_id?: string;
        name: string;
        quantity: number;
        unit_price: string;
    }>;
};

export type UpdateSaleBody = Partial<Omit<CreateSaleBody, "salon_id" | "items">>;

export type CheckoutSaleBody = {
    payment_method: PaymentMethod;
    payment_reference?: string;
    status?: "completed";
};
