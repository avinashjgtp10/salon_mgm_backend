// ─── Supplier ────────────────────────────────────────────────────────────────

export type SupplierType = "product" | "consumable" | "both";

export type Supplier = {
    id: string;
    name: string;
    description: string | null;
    first_name: string | null;
    last_name: string | null;
    mobile_country_code: string | null;
    mobile_number: string | null;
    telephone_country_code: string | null;
    telephone_number: string | null;
    email: string | null;
    website: string | null;
    street: string | null;
    suburb: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    country: string | null;
    same_as_physical: boolean;
    postal_street: string | null;
    postal_suburb: string | null;
    postal_city: string | null;
    postal_state: string | null;
    postal_zip_code: string | null;
    postal_country: string | null;
    is_active: boolean;
    // Supplier Master fields — see Migration/add_supplier_master_details.sql
    supplier_code: string | null;
    supplier_type: SupplierType;
    contact_person: string | null;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    business_registration_number: string | null;
    payment_terms_days: number;
    credit_limit: number;
    bank_account_holder_name: string | null;
    bank_name: string | null;
    bank_account_number: string | null;
    bank_ifsc_code: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateSupplierBody = {
    name: string;
    description?: string;
    first_name?: string;
    last_name?: string;
    mobile_country_code?: string;
    mobile_number?: string;
    telephone_country_code?: string;
    telephone_number?: string;
    email?: string;
    website?: string;
    street?: string;
    suburb?: string;
    city?: string;
    state?: string;
    zip_code?: string;
    country?: string;
    same_as_physical?: boolean;
    postal_street?: string | null;
    postal_suburb?: string | null;
    postal_city?: string | null;
    postal_state?: string | null;
    postal_zip_code?: string | null;
    postal_country?: string | null;
    is_active?: boolean;
    supplier_type?: SupplierType;
    contact_person?: string;
    address?: string;
    gstin?: string;
    pan?: string;
    business_registration_number?: string;
    payment_terms_days?: number;
    credit_limit?: number;
    bank_account_holder_name?: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_ifsc_code?: string;
    notes?: string;
};

// supplier_code is server-generated (see suppliersRepository.create) and
// immutable thereafter — never part of the writable body.
export type UpdateSupplierBody = Partial<CreateSupplierBody>;

// ─── Supplier balance (derived from purchases − supplier_payments) ───────────

export type SupplierPaymentStatus = "paid" | "due" | "overdue";

export type SupplierWithBalance = Supplier & {
    total_purchase_amount: number;
    pending_order_count: number;
    due_amount: number;
    due_date: string | null;
    status: SupplierPaymentStatus;
    // Operationally open (Sent/Partially Received) orders — a different
    // count from pending_order_count above (unpaid-balance orders).
    open_order_count: number;
};

export type PayoutMethod = "cash" | "upi" | "bank_transfer" | "cheque" | "card" | "other";

export type SupplierPayment = {
    id: string;
    salon_id: string;
    supplier_id: string;
    amount: number;
    payment_date: string;
    payment_method: PayoutMethod;
    note: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateSupplierPaymentBody = {
    amount: number;
    payment_date: string;
    payment_method: PayoutMethod;
    note?: string;
};

export type ListSupplierPaymentsFilters = {
    page?: number;
    limit?: number;
};

// ─── Stock Movement ──────────────────────────────────────────────────────────

export type MovementType = "in" | "out" | "adjustment" | "transfer";

export type StockMovement = {
    id: string;
    branch_id: string;
    product_id: string;
    supplier_id: string | null;
    movement_type: MovementType;
    quantity: number;
    unit_price: string | null;
    total_amount: string | null;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateStockMovementBody = {
    branch_id: string;
    product_id: string;
    supplier_id?: string;
    movement_type: MovementType;
    quantity: number;
    unit_price?: number;
    total_amount?: number;
    notes?: string;
};

// ─── Stock Take ──────────────────────────────────────────────────────────────

export type StocktakeStatus = "In progress" | "Paused" | "Review" | "Completed" | "Canceled";

export type Stocktake = {
    id: string;
    branch_id: string;
    name: string;
    description: string | null;
    status: StocktakeStatus;
    started_by: string;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateStocktakeBody = {
    branch_id: string;
    name?: string;
    description?: string;
    selection_type?: "all" | "category" | "manual";
};

export type StockTakeItem = {
    product_id: string;
    actual_qty: number;
    notes?: string;
};

export type StockTakeBody = {
    stocktake_id?: string; // Optional link to a stocktake event
    branch_id: string;
    notes?: string;
    items: StockTakeItem[];
};

export type StockTakeResult = {
    processed: number;
    movements: StockMovement[];
};

// ─── List filters ────────────────────────────────────────────────────────────

export type ListStockMovementsFilters = {
    product_id?: string;
    branch_id?: string;
    supplier_id?: string;
    movement_type?: MovementType;
    from_date?: string;
    to_date?: string;
    page?: number;
    limit?: number;
};

// ─── Stock Reconciliation ────────────────────────────────────────────────────

export type StockReconciliationRow = {
    product_id: string;
    category_name: string;
    item_name: string;
    actual_stock: number;
    adjust_stock: number;
    stock_difference: number;
    stock_value: number;
    actual_consumable: number;
    adjust_consumable: number;
    unit: string;
    consumable_difference: number;
    remark: string;
};


// ─── Consumable Usage ────────────────────────────────────────────────────────

export type ConsumableUsageItem = {
    product_id: string;
    product_name?: string;
    qty: number;
    unit?: string;
};

export type SaveConsumableUsageBody = {
    branch_id: string;
    booking_id?: string;
    items: ConsumableUsageItem[];
};
