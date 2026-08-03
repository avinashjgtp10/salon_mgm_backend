export const CONSUMABLE_USAGE_SORT_FIELDS = [
  "date", "product_name", "qty_used", "remaining_stock",
] as const;

export type ConsumableUsageSortField = typeof CONSUMABLE_USAGE_SORT_FIELDS[number];
export type SortDirection = "asc" | "desc";
export type StockStatus = "healthy" | "low_stock" | "out_of_stock";
export type ConsumableUsageTxnStatus = "completed" | "skipped" | "insufficient_override";

export interface ConsumableUsageRequest {
  salon_id: string;
  page: number;
  pageSize: number;
  search?: string;
  filters?: {
    product_id?: string | null;
    category_id?: string | null;
    service_id?: string | null;
    staff_id?: string | null;
    branch_id?: string | null;
    unit?: string | null;
    status?: ConsumableUsageTxnStatus | null;
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
  date: string;
  product_id: string;
  product_name: string;
  category_id: string | null;
  category_name: string | null;
  service_id: string | null;
  service_name: string | null;
  staff_id: string | null;
  staff_name: string | null;
  qty_used: number;
  unit: string;
  remaining_stock: number;
  supply_price: number | null;
  appointment_id: string | null;
  invoice_number: string | null;
  branch_id: string | null;
  status: ConsumableUsageTxnStatus;
  is_manual: boolean;
  configured_quantity: number | null;
  notes: string | null;
}

export interface ConsumableUsageResponse {
  summary: {
    total_consumables: number;
    total_quantity_used: number;
    current_stock_value: number;
    low_stock_items: number;
  };
  pagination: { page: number; pageSize: number; totalPages: number; totalRecords: number };
  items: ConsumableUsageItem[];
}

export interface ConsumableUsageHistoryFilters {
  page: number;
  pageSize: number;
  date_from?: string;
  date_to?: string;
  product_id?: string;
  category_id?: string;
  service_id?: string;
  staff_id?: string;
  branch_id?: string;
  status?: StockStatus;
  // Bypasses the pageSize cap, same as every report under reports.repository.ts
  // (see e.g. getPackageHistoryReportRows) so exports can fetch all rows.
  is_export?: boolean;
}
