// Backend for the dedicated "Consumable Inventory" page — replaces Stock
// Reconciliation's consumable-facing role with a purpose-built, inventory-
// first view. Reuses the same underlying data (products.amount as remaining
// volume, bottle_size for derived Stock Quantity, consumable_usage as the
// event ledger, service_consumables/appointment_service_consumables for the
// service relationship) rather than introducing a parallel data model.

export type ConsumableStatus = "healthy" | "low" | "out_of_stock";

export type ConsumableListFilters = {
  search?: string;
  category_id?: string;
  brand_id?: string;
  supplier_id?: string;
  status?: ConsumableStatus | "all";
  unit?: string; // measure_unit
  service_id?: string; // "assigned service" — reverse lookup via service_consumables
  sort_by?: "newest" | "lowest_stock" | "most_used" | "a_z";
  page?: number;
  limit?: number;
};

export type ConsumableListRow = {
  product_id: string;
  name: string;
  brand_name: string | null;
  category_name: string | null;
  supplier_name: string | null;
  unit: string; // measure_unit
  unit_size: number | null; // bottle_size — null when this product doesn't use bottle-based tracking
  product_qty: number; // derived bottle count (== remaining_stock when unit_size is null)
  total_stock: number; // product_qty * unit_size (== remaining_stock when unit_size is null)
  remaining_stock: number; // products.amount — canonical remaining volume
  qty_alert: number | null;
  used_today: number;
  used_this_month: number;
  assigned_services_count: number;
  // Latest consumable_usage.created_at for this product — null when it's
  // never actually been used (only configured on a recipe, never deducted).
  last_used_at: string | null;
  status: ConsumableStatus;
};

export type ConsumableListResponse = {
  data: ConsumableListRow[];
  total: number;
};

export type ConsumableKpis = {
  total_consumables: number;
  total_available_stock: number; // naive sum of remaining_stock across all consumables — mixed units, see repository note
  low_stock_items: number;
  assigned_services: number; // COUNT(DISTINCT service_id) across service_consumables for this salon's consumables
};

export type AssignedServiceRow = { service_id: string; name: string; qty: number; unit: string | null };

export type UnitConversion = { id: string; unit_name: string; conversion_to_base: number };
export type UnitConversionInput = { unit_name: string; conversion_to_base: number };

export type RecentConsumptionRow = {
  date: string;
  service_name: string | null;
  staff_name: string | null;
  qty: number;
  direction: "deduct" | "return";
};

export type ConsumableUsageStats = {
  used_today: number;
  used_this_week: number;
  used_this_month: number;
  average_per_service: number;
  estimated_services_remaining: number | null; // null when there's no usage history to average from
};

export type ConsumableDetail = ConsumableListRow & {
  bottle_size: number | null;
  supply_price: number | null;
  measure_unit: string;
  is_active: boolean;
  usage_stats: ConsumableUsageStats;
  assigned_services: AssignedServiceRow[];
  recent_consumption: RecentConsumptionRow[];
  stock_timeline: { label: string; remaining: number }[];
  unit_conversions: UnitConversion[];
};

export type UsageHistoryFilters = {
  product_id?: string;
  service_id?: string;
  direction?: "deduct" | "return";
  from?: string; // ISO date
  to?: string; // ISO date
  page?: number;
  limit?: number;
};

export type UsageHistoryRow = {
  id: string;
  date: string;
  product_id: string;
  product_name: string;
  unit: string | null;
  service_name: string | null;
  staff_name: string | null;
  qty: number;
  direction: "deduct" | "return";
  source: string | null;
};

export type UsageHistoryResponse = {
  data: UsageHistoryRow[];
  total: number;
};

export type AdjustStockReason = "purchase" | "damage" | "expired" | "manual_correction";

export type AdjustStockBody = {
  direction: "increase" | "decrease";
  qty: number; // in the recipe/consumption unit (matches products.amount's unit)
  reason: AdjustStockReason;
  note?: string;
  branch_id?: string;
};
