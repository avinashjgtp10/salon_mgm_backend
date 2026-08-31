// Stock Ledger — a full audit trail of every stock movement for a product,
// each row snapshotting the balance immediately after the movement. See
// Migration/create_stock_ledger_table.sql for why this is a new table
// rather than reusing stock_movements (movement_type there can't express
// this vocabulary without overloading its four buckets).

export type StockLedgerTransactionType =
    | "opening_stock"
    | "purchase"
    | "usage"
    | "sale"
    | "return"
    | "damage"
    | "expired"
    | "adjustment_in"
    | "adjustment_out"
    | "transfer_in"
    | "transfer_out";

export const STOCK_LEDGER_TRANSACTION_TYPES: StockLedgerTransactionType[] = [
    "opening_stock", "purchase", "usage", "sale", "return",
    "damage", "expired", "adjustment_in", "adjustment_out",
    "transfer_in", "transfer_out",
];

// Transaction types that add to stock — quantity is stored positive for
// these, negative for every other type. Drives the ledger's In/Out columns.
export const STOCK_LEDGER_IN_TYPES: StockLedgerTransactionType[] = [
    "opening_stock", "purchase", "return", "adjustment_in", "transfer_in",
];

export type StockLedgerEntry = {
    id: string;
    salon_id: string;
    branch_id: string;
    product_id: string;
    product_name: string;
    measure_unit: string | null;
    bottle_size: number | null;
    category: string | null;
    transaction_type: StockLedgerTransactionType;
    reference: string | null;
    quantity: number;
    unit_cost: string | null;
    balance_after: number;
    reason: string | null;
    notes: string | null;
    created_by: string | null;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateStockLedgerEntryBody = {
    branch_id: string;
    product_id: string;
    transaction_type: StockLedgerTransactionType;
    /** Unsigned — the repository applies the sign based on transaction_type. */
    quantity: number;
    reference?: string;
    unit_cost?: number;
    reason?: string;
    notes?: string;
};

export type UpdateStockLedgerEntryBody = {
    reference?: string;
    reason?: string;
    notes?: string;
};

export type ListStockLedgerFilters = {
    branch_id?: string;
    product_id?: string;
    category_id?: string;
    transaction_type?: StockLedgerTransactionType;
    staff_id?: string;
    search?: string;
    from_date?: string;
    to_date?: string;
    page?: number;
    limit?: number;
};

export type StockLedgerSummary = {
    total_products: number;
    total_stock: number;
    stock_in: number;
    stock_out: number;
};

export type StockLedgerTimelineEntry = StockLedgerEntry;
