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
    // Set when this purchase was recorded via an Order's Receive action —
    // null for a standalone purchase (Product Inventory's "Purchase" button
    // / Purchase History, no PO involved).
    order_id: string | null;
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
    // Set by orders.repository.ts's receive() when this purchase is being
    // created to record delivery against a Purchase Order — links the two
    // without duplicating purchasesRepository.create()'s transaction logic.
    order_id?: string | null;
    items: CreatePurchaseItemDTO[];
}

export interface ListPurchaseFilters {
    search?: string;
    supplier_id?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
}
