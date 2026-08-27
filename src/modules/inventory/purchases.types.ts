export interface PurchaseItem {
    id: string;
    purchase_id: string;
    product_id: string;
    product_name?: string;
    quantity: number;
    purchase_price: number;
    total_price: number;
    expiry_date: string | null;
    stock_movement_id: string | null;
    created_at: string;
}

export interface Purchase {
    id: string;
    salon_id: string;
    supplier_id: string;
    supplier_name?: string;
    purchase_number: string;
    purchase_date: string;
    total_amount: number;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    items?: PurchaseItem[];
    // Populated only by purchasesRepository.list()'s supplier-scoped query —
    // per-order payment status derived from supplier_payments applied
    // oldest-first (see suppliersRepository.getBalance / listOrdersWithBalance).
    amount_paid?: number;
    amount_due?: number;
    payment_status?: "paid" | "due" | "overdue";
}

export interface CreatePurchaseItemDTO {
    product_id: string;
    quantity: number;
    purchase_price: number;
    expiry_date?: string | null;
}

export interface CreatePurchaseDTO {
    supplier_id: string;
    purchase_date?: string;
    items: CreatePurchaseItemDTO[];
}

export interface ListPurchaseFilters {
    search?: string;
    supplier_id?: string;
    page?: number;
    limit?: number;
}
