// Supplier Products Catalog — a supplier's imported product list, matched
// against the salon's own `products` table where possible. See
// supplier-products.import.service.ts for the two-stage matching this feeds.

export type SupplierProductMatchStatus = "matched" | "unmatched";

export type SupplierProduct = {
    id: string;
    salon_id: string;
    supplier_id: string;
    product_id: string | null;
    // Resolved product's live name, if linked — never denormalized, always
    // joined live so a later rename in the catalog is reflected instead of
    // frozen at import time (same convention as product_audit_items).
    linked_product_name?: string | null;
    name: string;
    barcode: string | null;
    brand_id: string | null;
    brand_name?: string | null;
    category_id: string | null;
    category_name?: string | null;
    supplier_sku: string | null;
    price: number | null;
    hsn_sac: string | null;
    match_status: SupplierProductMatchStatus;
    ignored: boolean;
    created_at: string;
    updated_at: string;
};

export type ListSupplierProductsFilters = {
    // Suggested Products on New Order only wants addable rows — matched and
    // not ignored.
    matched_only?: boolean;
};

export type ResolveAction = "link" | "create_product" | "ignore";

export type ResolveSupplierProductBody = {
    action: ResolveAction;
    // Required when action === "link" — the existing product to attach.
    product_id?: string;
};

export type SupplierProductImportIssue = {
    row: number;
    name?: string;
    status: "failed";
    reason: string;
};

export type SupplierProductImportResult = {
    total: number;
    matched: number;
    unmatched: number;
    updated: number;
    failed: number;
    issues: SupplierProductImportIssue[];
};
