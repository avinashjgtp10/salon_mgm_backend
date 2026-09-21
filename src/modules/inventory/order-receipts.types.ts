// Receiving sessions against an Order — replaces the old single-shot
// receive() with a draft -> confirm workflow. A receipt lets a clerk enter
// Confirmed/Damaged quantities per line, pick a Receiving Location (branch)
// and Received By (staff), and Save Draft with zero stock effect.
// confirmReceipt() (order-receipts.repository.ts) is the one moment stock
// actually moves — it reuses purchasesRepository.create() for the confirmed
// delta, atomically with the status flip to 'confirmed', same pattern as
// product-audit.repository.ts#approveWithAdjustments.

export type OrderReceiptStatus = "draft" | "confirmed";

export type OrderReceiptItem = {
    id: string;
    order_receipt_id: string;
    order_item_id: string;
    product_id: string;
    product_name?: string;
    // Absolute cumulative targets (not deltas) — see the migration comment
    // for why (same principle as product_audit_items.physical_qty).
    confirmed_qty: number;
    damaged_qty: number;
    created_at: string;
    updated_at: string;
};

export type OrderReceipt = {
    id: string;
    salon_id: string;
    order_id: string;
    branch_id: string | null;
    branch_name?: string | null;
    received_by: string | null;
    received_by_name?: string | null;
    status: OrderReceiptStatus;
    created_by: string | null;
    confirmed_at: string | null;
    created_at: string;
    updated_at: string;
};

export type OrderReceiptWithItems = OrderReceipt & { items: OrderReceiptItem[] };

export type UpsertReceiptItemBody = {
    order_item_id: string;
    confirmed_qty: number;
    damaged_qty: number;
};

export type UpsertReceiptBody = {
    branch_id?: string | null;
    received_by?: string | null;
    items?: UpsertReceiptItemBody[];
};

export type ConfirmReceiptBody = {
    purchase_date?: string;
};
