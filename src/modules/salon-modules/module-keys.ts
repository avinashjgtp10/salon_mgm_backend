// Single source of truth for the modules a super admin can lock per salon.
// The frontend mirrors this list (src/features/modules/moduleKeys.ts) — keep
// the two in step. Settings and Billing are deliberately NOT here: locking
// them could strand a salon owner with no way to reach support.

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
    "coupons",
    "referral_earn",
    "pos_payments",
    "reward_points",
    "roles_permissions",
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
    for (const key of locked) {
        out.add(key);
        for (const child of MODULE_CHILDREN[key as ModuleKey] ?? []) out.add(child);
    }
    return out;
}
