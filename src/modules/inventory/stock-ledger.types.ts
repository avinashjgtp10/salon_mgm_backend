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
    | "transfer_out"
    | "sample"
    | "lost"
    | "internal_use"
    | "audit_adjustment_in"
    | "audit_adjustment_out";

export const STOCK_LEDGER_TRANSACTION_TYPES: StockLedgerTransactionType[] = [
    "opening_stock", "purchase", "usage", "sale", "return",
    "damage", "expired", "adjustment_in", "adjustment_out",
    "transfer_in", "transfer_out", "sample", "lost", "internal_use",
    "audit_adjustment_in", "audit_adjustment_out",
];

// Transaction types that add to stock — quantity is stored positive for
// these, negative for every other type. Drives the ledger's In/Out columns.
// sample/lost/internal_use all consume stock, so they're stock-out like
// usage/damage/expired — none of them add to it.
export const STOCK_LEDGER_IN_TYPES: StockLedgerTransactionType[] = [
    "opening_stock", "purchase", "return", "adjustment_in", "transfer_in",
    "audit_adjustment_in",
];

// audit_adjustment_in/out are written only by
// product-audit.repository.ts#approveWithAdjustments when an approved audit's
// physical count differs from system stock — never offered as a manual entry
// choice (see ADJUSTMENT_TXN_TYPES on the frontend), so these rows always
// trace back to a real audit via their `notes` (audit_id:<id>) and
// `reference` (Audit: <name>).

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
    /** Which supplier this stock actually came from, when known — set only
     *  when the person recording it (typically an Add Stock "Purchase Stock"
     *  entry) explicitly picked one. NULL for everything else: Client
     *  Return, Branch Transfer, Opening Stock, adjustments, sales, expiry
     *  write-offs. Purely a display/attribution field on the ledger itself —
     *  does NOT feed Purchase History or supplier balances, which stay
     *  sourced from purchases/purchase_items only (see
     *  Migration/add_stock_ledger_supplier.sql). */
    supplier_id: string | null;
    supplier_name: string | null;
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
    supplier_id?: string;
};

export type UpdateStockLedgerEntryBody = {
    reference?: string;
    reason?: string;
    notes?: string;
    /** Pass "" (empty string) to clear a previously-set supplier. */
    supplier_id?: string;
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
