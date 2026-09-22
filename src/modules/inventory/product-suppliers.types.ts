// Multi-supplier pricing per product — one product can be sourced from
// several suppliers, each with their own SKU and price. Additive alongside
// products.supplier_id/supply_price, which remain "the preferred/default
// supplier" for every existing reader.

export type ProductSupplier = {
    id: string;
    salon_id: string;
    product_id: string;
    supplier_id: string;
    supplier_name?: string;
    supplier_sku: string | null;
    price: number | null;
    is_preferred: boolean;
    created_at: string;
    updated_at: string;
};

export type AddProductSupplierBody = {
    supplier_id: string;
    supplier_sku?: string;
    price?: number;
    is_preferred?: boolean;
};

export type UpdateProductSupplierBody = Partial<Omit<AddProductSupplierBody, "supplier_id">>;
