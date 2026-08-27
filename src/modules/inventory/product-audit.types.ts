// Product Audit — count physical stock against system quantities and
// reconcile differences. Deliberately read-only against products.amount:
// this module never writes stock (unlike stockTakeService.process), so it
// can be reviewed/rejected/reopened freely without touching real inventory.

export type ProductAuditStatus = "in_progress" | "pending_review" | "complete" | "rejected";

export type ProductAuditItem = {
    id: string;
    audit_id: string;
    product_id: string;
    product_name: string;
    sku: string | null;
    category: string | null;
    system_qty: number;
    physical_qty: number | null;
    reason: string | null;
    created_at: string;
    updated_at: string;
};

export type ProductAuditHistoryEntry = {
    id: string;
    audit_id: string;
    actor_id: string | null;
    actor_name: string | null;
    action: string;
    note: string | null;
    created_at: string;
};

export type ProductAudit = {
    id: string;
    salon_id: string;
    branch_id: string;
    name: string;
    notes: string | null;
    status: ProductAuditStatus;
    auditor_id: string;
    auditor_name: string | null;
    reviewer_id: string | null;
    reviewer_name: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
};

export type ProductAuditWithDetail = ProductAudit & {
    items: ProductAuditItem[];
    history: ProductAuditHistoryEntry[];
};

export type ProductAuditListRow = ProductAudit & {
    item_count: number;
    diff_count: number;
};

export type CreateProductAuditBody = {
    branch_id: string;
    name: string;
    notes?: string;
    /** Defaults to the creating user when omitted — same "creator can assign
     *  to someone else" convention as appointments.staff_id. */
    auditor_id?: string;
};

export type AddAuditItemsBody = {
    product_ids: string[];
};

export type UpdateAuditItemBody = {
    physical_qty: number | null;
    reason?: string | null;
};

export type RejectAuditBody = {
    reason: string;
};

export type ListProductAuditsFilters = {
    branch_id?: string;
    status?: ProductAuditStatus;
    search?: string;
    page?: number;
    limit?: number;
};
