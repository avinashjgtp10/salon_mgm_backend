export type PlanTier = "basic" | "advance" | "pro";
export const PLAN_TIER_ORDER: PlanTier[] = ["basic", "advance", "pro"];

export type FeatureKeyEntry = { key: string; label: string };

export type SalonPlanDefinition = {
    tier: PlanTier;
    name: string;
    tagline: string | null;
    price: string;
    features: string[];
    // Stable {key, label} pairs — .key is the actual enforcement source of
    // truth requirePlanFeature()/hasFeature() check against; .label is
    // admin-editable display text shown on the Salon Customization toggle
    // grid. Deliberately NOT the same list as "features" above (that's
    // pricing-card marketing copy — different count, different wording).
    // See Migration/fix_feature_keys_shape.sql.
    feature_keys: FeatureKeyEntry[];
    default_staff_limit: number | null;
    default_customer_limit: number | null;
    default_appointment_limit: number | null;
    default_branch_limit: number | null;
    default_storage_limit_gb: number | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
};

export type UpdatePlanDefinitionBody = {
    name?: string;
    tagline?: string | null;
    price?: number;
    features?: string[];
    feature_keys?: FeatureKeyEntry[];
    default_staff_limit?: number | null;
    default_customer_limit?: number | null;
    default_appointment_limit?: number | null;
    default_branch_limit?: number | null;
    default_storage_limit_gb?: number | null;
};

export type SalonPlanCustomization = {
    id: string;
    salon_id: string;
    base_tier: PlanTier;
    custom_price: string | null;
    staff_limit: number | null;
    customer_limit: number | null;
    appointment_limit: number | null;
    branch_limit: number | null;
    storage_limit_gb: number | null;
    // Keyed by featureKey (e.g. "inventory"), NOT the admin-editable display
    // name — see SalonPlanDefinition.feature_keys.
    feature_overrides: Record<string, boolean>;
    start_date: string;
    expiry_date: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
};

// Every field optional except base_tier — a salon with no customization row
// yet is created on first save with whatever fields the admin touched,
// everything else falling back to the base tier's own defaults.
export type UpsertSalonCustomizationBody = {
    base_tier: PlanTier;
    custom_price?: number | null;
    staff_limit?: number | null;
    customer_limit?: number | null;
    appointment_limit?: number | null;
    branch_limit?: number | null;
    storage_limit_gb?: number | null;
    feature_overrides?: Record<string, boolean>;
    start_date?: string;
    expiry_date?: string | null;
};

export type SalonPlanInvoiceStatus = "paid" | "open" | "pending" | "overdue" | "failed" | "void";

export type BillingCycle = "monthly" | "quarterly" | "annual";
export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
    monthly: "Monthly Plan",
    quarterly: "Quarterly Plan",
    annual: "Annual Plan",
};

export type SalonPlanInvoice = {
    id: string;
    invoice_number: string;
    invoice_no: string | null;
    financial_year: string | null;
    salon_id: string;
    plan_tier: PlanTier;
    branch: string | null;
    billing_cycle: BillingCycle;
    period_start: string | null;
    period_end: string | null;
    payment_mode: string | null;
    amount: string;
    subtotal: string | null;
    gst_amount: string | null;
    status: SalonPlanInvoiceStatus;
    issued_date: string;
    due_date: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateInvoiceBody = {
    salon_id: string;
    plan_tier: PlanTier;
    branch?: string;
    billing_cycle: BillingCycle;
    period_start: string;
    period_end: string;
    payment_mode?: string;
    amount: number;
    apply_gst?: boolean;
    status?: SalonPlanInvoiceStatus;
    issued_date?: string;
    due_date?: string | null;
};

export type ListInvoicesFilters = {
    salon_id?: string;
    status?: SalonPlanInvoiceStatus;
    branch?: string;
    search?: string; // matches invoice_number or salon name
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
};

// Row shape returned by the salon-customization list/search endpoint — the
// customization joined with the salon/owner it belongs to, one row per
// salon that HAS a customization (salons without one aren't customized yet
// and don't need admin attention on this screen).
export type SalonCustomizationListRow = SalonPlanCustomization & {
    salon_name: string;
    owner_email: string | null;
    is_customized: boolean; // true whenever any field departs from base_tier's own defaults
};
