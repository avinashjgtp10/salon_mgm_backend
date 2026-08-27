export type OrderTaxType = "inclusive" | "exclusive";

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
    created_at: string;
}

export interface Order {
    id: string;
    salon_id: string;
    order_number: string;
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
    items: CreateOrderItemDTO[];
}

export interface ListOrderFilters {
    search?: string;
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
