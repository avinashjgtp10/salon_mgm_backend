// Single source of truth for the modules a super admin can lock per salon.
// The frontend mirrors this list (src/features/modules/moduleKeys.ts) — keep
// the two in step. Settings and Billing are deliberately NOT here: locking
// them could strand a salon owner with no way to reach support.

// Reports: "reports" -> one switch per category -> one switch per report.
export const REPORT_CATEGORY_KEYS = [
    "report_cat_sales",
    "report_cat_payments",
    "report_cat_customers",
    "report_cat_staff",
    "report_cat_appointments",
    "report_cat_inventory",
    "report_cat_packages",
    "report_cat_marketing",
] as const;

export const REPORT_KEYS_BY_CATEGORY = {
    sales: ["report_sales_summary", "report_daily_sheet", "report_product_sale", "report_service_sale", "report_taxes", "report_product_margin", "report_reward", "report_ewallet"],
    payments: ["report_payment_collection", "report_pending_payment", "report_cash_management"],
    customers: ["report_all_clients", "report_client_revenue", "report_customer_frequency", "report_lost_customers", "report_customer_spend", "report_service_frequency", "report_referral_report", "report_client_source", "report_client_rating", "report_enquiry_report"],
    staff: ["report_staff_sales", "report_staff_performance", "report_staff_item_sales", "report_commission_report", "report_tip_report", "report_attendance_report", "report_payroll_history", "report_rebooking_rate"],
    appointments: ["report_appointment_detail", "report_online_appointment", "report_upcoming_appointments", "report_no_show_recovery"],
    inventory: ["report_product_inventory", "report_slow_moving_products", "report_fast_moving_products", "report_brand_performance", "report_purchase_vs_sales", "report_consumable_usage", "report_consumable_analytics", "report_supplier_report", "report_purchase_history", "report_stock_movement"],
    packages: ["report_package_sale", "report_package_history", "report_member_sale", "report_membership_history"],
    marketing: ["report_wa_campaign", "report_mkt_feedback", "report_open_rate", "report_reply_rate", "report_birthday_campaign", "report_new_client_follow_up", "report_cancellation_recovery", "report_membership_opportunity", "report_birthday", "report_anniversary"],
} as const;

export const REPORT_KEYS = [
    ...REPORT_KEYS_BY_CATEGORY.sales,
    ...REPORT_KEYS_BY_CATEGORY.payments,
    ...REPORT_KEYS_BY_CATEGORY.customers,
    ...REPORT_KEYS_BY_CATEGORY.staff,
    ...REPORT_KEYS_BY_CATEGORY.appointments,
    ...REPORT_KEYS_BY_CATEGORY.inventory,
    ...REPORT_KEYS_BY_CATEGORY.packages,
    ...REPORT_KEYS_BY_CATEGORY.marketing,
] as const;

export const MODULE_KEYS = [
    "dashboard",
    "quick_sale",
    "calendar",
    "clients",
    "clients_list",
    "referral_rewards",
    "client_history",
    "enquiries",
    "catalog",
    "services",
    "products",
    "packages",
    "memberships",
    "tool_tracking",
    "inventory",
    "suppliers",
    "orders",
    "product_inventory",
    "consumable_inventory",
    "product_audit",
    "stock_ledger",
    "staff",
    "staff_members",
    "scheduled_shifts",
    "tip_commission",
    "attendance",
    "staff_history",
    "payroll",
    "cash_management",
    "marketing",
    "online_booking",
    "reports",
    ...REPORT_CATEGORY_KEYS,
    ...REPORT_KEYS,
    "settings_group",
    "coupons",
    "referral_earn",
    "pos_payments",
    "reward_points",
    "roles_permissions",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

// Locking a parent locks everything under it; locking a child leaves its
// siblings alone.
export const MODULE_CHILDREN: Partial<Record<ModuleKey, ModuleKey[]>> = {
    clients: ["clients_list", "referral_rewards", "client_history", "enquiries"],
    catalog: ["services", "products", "packages", "memberships", "tool_tracking"],
    inventory: ["suppliers", "orders", "product_inventory", "consumable_inventory", "product_audit", "stock_ledger"],
    settings_group: ["coupons", "referral_earn", "pos_payments", "reward_points", "roles_permissions"],
    reports: [...REPORT_CATEGORY_KEYS],
    report_cat_sales: [...REPORT_KEYS_BY_CATEGORY.sales],
    report_cat_payments: [...REPORT_KEYS_BY_CATEGORY.payments],
    report_cat_customers: [...REPORT_KEYS_BY_CATEGORY.customers],
    report_cat_staff: [...REPORT_KEYS_BY_CATEGORY.staff],
    report_cat_appointments: [...REPORT_KEYS_BY_CATEGORY.appointments],
    report_cat_inventory: [...REPORT_KEYS_BY_CATEGORY.inventory],
    report_cat_packages: [...REPORT_KEYS_BY_CATEGORY.packages],
    report_cat_marketing: [...REPORT_KEYS_BY_CATEGORY.marketing],
    staff: ["staff_members", "payroll", "scheduled_shifts", "tip_commission", "attendance", "staff_history"],
};

export const MODULE_LOCKED_MESSAGE =
    "Your plan doesn't include this feature. Upgrade your plan to take control of it.";

export function isModuleKey(value: unknown): value is ModuleKey {
    return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

// The keys that are effectively locked once parent → child locking is applied.
export function expandLockedKeys(locked: Iterable<string>): Set<string> {
    const out = new Set<string>();
    const add = (key: string) => {
        if (out.has(key)) return;
        out.add(key);
        for (const child of MODULE_CHILDREN[key as ModuleKey] ?? []) add(child);
    };
    for (const key of locked) add(key);
    return out;
}
