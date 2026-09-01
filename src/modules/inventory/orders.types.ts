export type OrderTaxType = "inclusive" | "exclusive";

// draft: not yet sent to the supplier, still freely editable (not implemented
// as an edit flow yet, but distinct from "sent" so it doesn't count as a real
// open PO). sent: placed, awaiting delivery. partially_received/received: set
// by the Receive action below as order_items.received_qty fills up against
// qty. cancelled: terminal, blocks further receiving.
export type OrderStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";

export interface OrderItem {
    id: string;
    order_id: string;
    product_id: string;
    product_name?: string;
    product_code: string | null;
    qty: number;
    selling_price: number;
    discount_percent: number;
    cost_price: number;
    cost_wo_tax: number;
    total_cost_wo_tax: number;
    total_tax: number;
    // How much of `qty` has actually arrived so far, via the Receive action.
    // Never exceeds qty (receive() clamps it).
    received_qty: number;
    created_at: string;
}

export interface Order {
    id: string;
    salon_id: string;
    order_number: string;
    status: OrderStatus;
    supplier_id: string;
    supplier_name?: string;
    bill_to_branch_id: string | null;
    ship_to_branch_id: string | null;
    order_date: string;
    remark: string | null;
    ref_number: string | null;
    payment_terms_days: number | null;
    shipment_date: string | null;
    delivery_date: string | null;
    tax_type: OrderTaxType;
    tax_group: string | null;
    terms_conditions: string | null;
    signature_url: string | null;
    shipping_cost: number;
    total_quantity: number;
    total_price: number;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    items?: OrderItem[];
}

export interface CreateOrderItemDTO {
    product_id: string;
    product_code?: string;
    qty: number;
    selling_price: number;
    discount_percent?: number;
    cost_price: number;
}

export interface CreateOrderDTO {
    // Omitted/undefined means "sent" (placed) — the normal Create Order path.
    // "draft" is the only other value a caller may set directly (Save Draft).
    status?: "draft" | "sent";
    supplier_id: string;
    bill_to_branch_id?: string;
    ship_to_branch_id?: string;
    order_date?: string;
    remark?: string;
    ref_number?: string;
    payment_terms_days?: number;
    shipment_date?: string;
    delivery_date?: string;
    tax_type: OrderTaxType;
    tax_group?: string;
    tax_rate?: number;
    terms_conditions?: string;
    signature_url?: string;
    shipping_cost?: number;
    items: CreateOrderItemDTO[];
}

// One line per order_item being received THIS time — a partial delivery
// sends only the items/quantities that actually arrived; a later call
// receives the rest. received_qty here is the delta for this delivery, not
// the new running total (the repository adds it on).
export interface ReceiveOrderItemDTO {
    order_item_id: string;
    received_qty: number;
}

export interface ReceiveOrderDTO {
    items: ReceiveOrderItemDTO[];
    purchase_date?: string;
}

// Corrects a mis-entered received_qty after the fact — this is the NEW
// running total for the line, not a delta (unlike ReceiveOrderItemDTO).
export interface CorrectReceivedQtyDTO {
    received_qty: number;
}

export interface ListOrderFilters {
    search?: string;
    status?: OrderStatus;
    page?: number;
    limit?: number;
}

export interface OrderSignature {
    id: string;
    salon_id: string;
    url: string;
    created_by: string | null;
    created_at: string;
}
