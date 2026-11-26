export interface PurchaseItem {
    id: string;
    purchase_id: string;
    product_id: string;
    product_name?: string;
    quantity: number;
    purchase_price: number;
    total_price: number;
    // Tax % applied to this line (past bills). total_price already includes it. 0 for ordinary purchases.
    tax_percent?: number;
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
    // The staff member who physically received the stock (chosen on Record
    // Purchase / Receive Against Order) — distinct from created_by, the user
    // who entered it. Null for purchases recorded before this existed.
    received_by_staff_id?: string | null;
    received_by_name?: string | null;
    // order_number of the Purchase Order this delivery was received against.
    po_number?: string | null;
    created_at: string;
    updated_at: string;
    items?: PurchaseItem[];
    // Populated only by purchasesRepository.list()'s supplier-scoped query —
    // per-order payment status derived from supplier_payments applied
    // oldest-first (see suppliersRepository.getBalance / listOrdersWithBalance).
    amount_paid?: number;
    amount_due?: number;
    payment_status?: "paid" | "due" | "overdue";
    // FALSE for a past bill added with "Add Past Bill (no stock change)"; TRUE for everything else.
    stock_applied?: boolean;
    // Computed by the server (list + getById): true when the bill never changed stock and has no purchase order (past or migrated bill), so Edit / Delete are allowed.
    is_historical?: boolean;
    bill_number?: string | null;
    notes?: string | null;
    // Only on the supplier Orders list (list()): per-bill sums over its lines. subtotal_amount is before tax.
    total_quantity?: number;
    subtotal_amount?: number;
    tax_amount?: number;
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
    // Explicit receiving location — nothing currently sets this (the only
    // writer was the removed order-receipts confirmReceipt()). Omitted
    // falls back to the salon's main-branch auto-resolution.
    branch_id?: string | null;
    // Staff member who received the stock — must belong to this salon.
    received_by_staff_id?: string | null;
    items: CreatePurchaseItemDTO[];
}

// A past supplier bill recorded for the books only: no stock change, no expiry (an old expiry date would trip the
// expiry write-off scheduler, which reads purchase_items.expiry_date).
export interface CreateHistoricalPurchaseDTO {
    supplier_id: string;
    purchase_date: string;
    bill_number?: string | null;
    notes?: string | null;
    // id = the existing purchase_items row (sent when editing); required to edit a bill that already moved stock.
    items: { id?: string; product_id: string; quantity: number; purchase_price: number; tax_percent?: number }[];
}

// Product lines ADDED to an existing past bill (nothing already on the bill is touched). Whole-number quantities, like any new past-bill line.
export interface AddHistoricalItemsDTO {
    items: { product_id: string; quantity: number; purchase_price: number; tax_percent?: number }[];
}

export interface ListPurchaseFilters {
    search?: string;
    supplier_id?: string;
    // Powers Product Inventory's detail drawer "Purchase History" tab —
    // every purchase with at least one line item for this product.
    product_id?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
}

// Powers the Purchase History report's Graph page.
export interface PurchaseChartFilters {
    search?: string;
    supplier_id?: string;
    date_from?: string;
    date_to?: string;
}

export interface PurchaseChartResponse {
    daily: { date: string; count: number; amount: number }[];
    top_suppliers: { supplier_id: string | null; supplier_name: string; amount: number }[];
    top_products: { product_name: string; quantity: number; amount: number }[];
}
