export type MeasureUnit = "ml" | "l" | "g" | "kg" | "pcs" | "oz" | "lb" | "bottle" | "tube" | "pack" | "box" | "roll";
export type TaxType = "no_tax" | "gst_5" | "gst_12" | "gst_18" | "gst_28" | "custom";
export type ProductType = "retail" | "consumable" | "both";

export type Product = {
    id: string;
    name: string;
    barcode: string | null;
    brand_id: string | null;
    category_id: string | null;
    supplier_id: string | null;
    measure_unit: MeasureUnit;
    product_type: ProductType;
    size: string | null;
    amount: number;
    // Opt-in bottle-based stock tracking (nullable — most products don't use
    // this). When set, `amount` is the remaining volume in the recipe's
    // consumption unit (e.g. ml), and Stock Quantity for display purposes is
    // CEIL(amount / bottle_size), computed at the Stock Reconciliation query
    // — not stored redundantly here.
    bottle_size: number | null;
    qty_alert: number | null;
    short_description: string | null;
    description: string | null;
    remark: string | null;
    lot_number: string | null;
    supply_price: number;
    retail_sales_enabled: boolean;
    retail_price: number | null;
    markup_percentage: number | null;
    tax_type: TaxType;
    custom_tax_rate: number | null;
    tax_group: string | null;
    hsn_sac: string | null;
    team_commission_enabled: boolean;
    team_commission_rate: number | null;
    // 'YYYY-MM-DD' text, or null when the product has no tracked expiry.
    expiry_date: string | null;
    // Whether this product is visible on public-facing surfaces (e.g. a
    // client-facing booking/catalog page) — distinct from is_active, which
    // controls whether the product is usable/sellable internally at all.
    is_public: boolean;
    // Soft-delete/deactivate flag — a deactivated product drops out of
    // Consumable Inventory's default list and stops being sellable/usable
    // (Products page, service consumable pickers), but stays in the DB so its
    // history (sales, consumable_usage, service_consumables) is never orphaned.
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type ProductPhoto = {
    id: string;
    product_id: string;
    url: string;
    filename: string;
    sort_order: number;
    created_at: string;
    updated_at: string;
};

export type Brand = {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
};

export type CreateProductBody = {
    name: string;
    barcode?: string;
    brand_id?: string;
    category_id?: string;
    supplier_id?: string;
    measure_unit?: string;
    product_type?: string;
    size?: string;
    amount?: number;
    bottle_size?: number | null;
    qty_alert?: number;
    short_description?: string;
    description?: string;
    remark?: string;
    lot_number?: string;
    supply_price?: number;
    retail_sales_enabled?: boolean;
    retail_price?: number;
    markup_percentage?: number;
    tax_type?: string;
    custom_tax_rate?: number;
    tax_group?: string;
    hsn_sac?: string;
    team_commission_enabled?: boolean;
    team_commission_rate?: number;
    expiry_date?: string | null;
    is_active?: boolean;
    is_public?: boolean;
};

export type UpdateProductBody = Partial<CreateProductBody>;

export type CreateBrandBody = {
    name: string;
};

export type UpdateBrandBody = Partial<CreateBrandBody>;

export type ProductListFilters = {
    search?: string;
    category_id?: string;
    brand_id?: string;
    product_type?: ProductType;
    retail_sales_enabled?: boolean;
    min_price?: number;
    max_price?: number;
    stock?: "all" | "low" | "out_of_stock";
    // Defaults to active-only (see _buildFilterConditions) — pass false
    // explicitly to see deactivated products, e.g. a future "Show inactive" toggle.
    is_active?: boolean;
    sort_by?: string;
    sort_order?: "ASC" | "DESC";
    page?: number;
    limit?: number;
};

export type ReorderPhotosBody = {
    photo_ids: string[];
};
