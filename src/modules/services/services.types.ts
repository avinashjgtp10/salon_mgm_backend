// ─── Shared ───────────────────────────────────────────────────────────────────
export type PriceType = "fixed" | "from" | "free";
export type ScheduleType = "sequence" | "parallel";
export type BundlePriceType = "service_pricing" | "fixed" | "free";
export type AvailableFor = "all" | "male" | "female" | "other";

// ─── Service ──────────────────────────────────────────────────────────────────
export type ServiceConsumableItem = {
  product_id: string;
  product_name?: string;
  qty: number;
  unit?: string;
  // Read-only enrichment — present on responses (see
  // CONSUMABLES_USED_SUBQUERY), never accepted on write. `stock` is the
  // product's current on-hand amount in BASE units at the time of the read.
  stock?: number;
  bottle_size?: number | null;
  measure_unit?: string;
};

// How a per-service commission override is applied to that service's revenue.
// "percentage" → % of revenue; "fixed" → flat ₹ per unit sold.
export type ServiceCommissionKind = "percentage" | "fixed";

export type Service = {
  id: string;
  name: string;
  category_id: string;
  category_name: string | null;
  treatment_type: string | null;
  description: string | null;
  price_type: PriceType;
  price: string;
  duration: number;
  online_booking: boolean;
  // Legacy and inert: false on every row, and the commission engine never
  // reads it. Per-service commission is driven by commission_rate/_kind below.
  commission_enabled: boolean;
  // NULL means "no override" — this service earns under the staff's
  // commission_rules / staff_commission_settings, as it always has.
  commission_rate: string | null;
  commission_kind: ServiceCommissionKind | null;
  resource_required: boolean;
  is_active: boolean;
  consumables_used: ServiceConsumableItem[];
  // Read-only, from STAFF_COUNT_SUBQUERY. 0 means "all staff" (no
  // service_staff rows), not "nobody" — render it accordingly.
  staff_count?: number;
  created_at: string;
  updated_at: string;
};

export type ServiceStaff = {
  staff_id: string;
  name: string;
};

export type AddOnOption = {
  id: string;
  add_on_group_id: string;
  name: string;
  description: string | null;
  additional_price: string;
  additional_duration: number;
  created_at: string;
  updated_at: string;
};

export type AddOnGroup = {
  id: string;
  service_id: string;
  name: string;
  prompt_to_client: string | null;
  min_quantity: number | null;
  max_quantity: number | null;
  allow_multiple_same: boolean;
  created_at: string;
  updated_at: string;
};

export type AddOnGroupDetail = AddOnGroup & {
  options: AddOnOption[];
};

export type ServiceConsultationForm = {
  id: string;
  service_id: string;
  name: string;
  is_selected: boolean;
  values: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ServiceDetail = Service & {
  staff: ServiceStaff[];
  add_on_groups: AddOnGroupDetail[];
  consultation_forms: ServiceConsultationForm[];
};

export type ListServicesQuery = {
  category_id?: string;
  search?: string;
  status?: "active" | "inactive";
  type?: "single" | "bundle";
  staff_id?: string;
  online_booking?: "enabled" | "disabled" | "all";
  commissions?: "enabled" | "disabled" | "all";
  resource_requirements?: "required" | "not_required" | "all";
  page?: number;
  limit?: number;
};

export type CreateServiceBody = {
  name: string;
  category_id: string;
  treatment_type?: string;
  description?: string;
  price_type?: PriceType;
  price?: number;
  duration?: number;
  online_booking?: boolean;
  commission_enabled?: boolean;
  resource_required?: boolean;
  // Per-service commission override. Send both together, or send both as null
  // to clear the override and fall back to the staff's commission rules.
  commission_rate?: number | null;
  commission_kind?: ServiceCommissionKind | null;
  // Settable at creation now — the INSERT writes it explicitly rather than
  // relying on the column default, so a service can be created inactive.
  is_active?: boolean;
  staff_ids?: string[];
  consumables_used?: ServiceConsumableItem[];
};

export type UpdateServiceBody = Partial<CreateServiceBody>;

export type CreateAddOnGroupBody = {
  name: string;
  prompt_to_client?: string;
  min_quantity?: number;
  max_quantity?: number;
  allow_multiple_same?: boolean;
};

export type UpdateAddOnGroupBody = Partial<CreateAddOnGroupBody>;

export type CreateAddOnOptionBody = {
  name: string;
  description?: string;
  additional_price?: number;
  additional_duration?: number;
};

export type UpdateAddOnOptionBody = Partial<CreateAddOnOptionBody>;

export type CreateConsultationFormBody = {
  name: string;
};

export type UpdateConsultationFormBody = {
  name?: string;
  is_selected?: boolean;
  values?: Record<string, unknown> | null;
};

// ─── Bundle ───────────────────────────────────────────────────────────────────
export type Bundle = {
  id: string;
  name: string;
  category_id: string;
  category_name: string | null;
  description: string | null;
  schedule_type: ScheduleType;
  price_type: BundlePriceType;
  retail_price: string;
  online_booking: boolean;
  commission_enabled: boolean;
  resource_required: boolean;
  available_for: AvailableFor;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BundleServiceItem = {
  service_id: string;
  name: string;
  price: string;
  duration: number;
  price_type: string;
  sort_order: number;
};

export type BundleDetail = Bundle & {
  services: BundleServiceItem[];
};

export type ListBundlesQuery = {
  category_id?: string;
  search?: string;
  status?: "active" | "inactive";
  team_member_id?: string;
  online_booking?: "enabled" | "disabled" | "all";
  commissions?: "enabled" | "disabled" | "all";
  resource_requirements?: "required" | "not_required" | "all";
  available_for?: AvailableFor | "all";
  page?: number;
  limit?: number;
};

export type CreateBundleBody = {
  name: string;
  category_id: string;
  description?: string;
  schedule_type?: ScheduleType;
  price_type?: BundlePriceType;
  retail_price?: number;
  online_booking?: boolean;
  commission_enabled?: boolean;
  resource_required?: boolean;
  available_for?: AvailableFor;
  service_ids?: string[];
};

export type UpdateBundleBody = Partial<CreateBundleBody> & {
  is_active?: boolean;
};

export type Pagination = {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

export type ServiceListResponse = {
  data: Service[];
  pagination: Pagination;
};

export type BundleListResponse = {
  data: Bundle[];
  pagination: Pagination;
};