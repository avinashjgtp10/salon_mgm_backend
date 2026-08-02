export const CONSUMABLE_USAGE_SORT_FIELDS = [
  "product_name", "current_stock", "configured_qty", "actual_used", "remaining_stock", "category",
] as const;

export type ConsumableUsageSortField = typeof CONSUMABLE_USAGE_SORT_FIELDS[number];
export type SortDirection = "asc" | "desc";
export type StockStatus = "healthy" | "low_stock" | "out_of_stock";

export interface ConsumableUsageRequest {
  salon_id: string;
  page: number;
  pageSize: number;
  search?: string;
  filters?: {
    category_id?: string | null;
    service_id?: string | null;
    unit?: string | null;
    stock_status?: StockStatus | null;
    date_from?: string | null;
    date_to?: string | null;
  };
  sort?: {
    field: ConsumableUsageSortField;
    direction: SortDirection;
  };
}

export interface ConsumableUsageItem {
  id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  category_name: string | null;
  unit: string;
  current_stock: number;
  configured_qty: number;
  actual_used: number;
  remaining_stock: number;
  last_used: string | null;
  usage_count: number;
  stock_status: StockStatus;
  // Container-based stock tracking (bottle/container inventory). `bottle_size`
  // is null when the product has no configured container size — in that case
  // `stock_quantity` falls back to the raw `remaining_stock` figure and
  // `total_available_volume` is null, matching pre-container behavior exactly.
  bottle_size: number | null;
  stock_quantity: number;
  total_available_volume: number | null;
}

export interface ConsumableUsageResponse {
  summary: {
    total_consumable_products: number;
    today_consumption: number;
    low_stock_products: number;
    appointments_using_consumables: number;
  };
  pagination: { page: number; pageSize: number; totalPages: number; totalRecords: number };
  items: ConsumableUsageItem[];
}
