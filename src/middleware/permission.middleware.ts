import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { AppError } from "./error.middleware";
import logger from "../config/logger";

export interface PermUser {
    userId: string;
    role?: string;
    salonId?: string | null;
}

const CACHE_TTL_MS = 60_000; // 1 minute

// ── Global role-level cache ────────────────────────────────────────────────────
// salonId → { perms, expiresAt }
const rolePermCache = new Map<string, {
    perms: Record<string, { staff: boolean }>;
    expiresAt: number;
}>();

async function loadRolePerms(salonId: string): Promise<Record<string, { staff: boolean }>> {
    const now = Date.now();
    const cached = rolePermCache.get(salonId);
    if (cached && cached.expiresAt > now) return cached.perms;

    const { rows } = await pool.query(
        `SELECT value FROM salon_settings WHERE salon_id = $1 AND key = 'role_permissions' LIMIT 1`,
        [salonId]
    );

    if (!rows[0]?.value) return {};

    try {
        const parsed = JSON.parse(rows[0].value) as Record<string, { owner: boolean; staff: boolean }>;
        const simplified: Record<string, { staff: boolean }> = {};
        for (const [k, v] of Object.entries(parsed)) {
            simplified[k] = { staff: v.staff };
        }
        rolePermCache.set(salonId, { perms: simplified, expiresAt: now + CACHE_TTL_MS });
        return simplified;
    } catch {
        return {};
    }
}

export function invalidatePermissionCache(salonId: string) {
    rolePermCache.delete(salonId);
}

// ── Per-staff custom permissions cache ────────────────────────────────────────
// userId → { customPerms, expiresAt }
const staffPermCache = new Map<string, {
    customPerms: Record<string, boolean> | null;
    expiresAt: number;
}>();

async function loadStaffCustomPerms(
    userId: string,
    salonId: string
): Promise<Record<string, boolean> | null> {
    const now = Date.now();
    const cached = staffPermCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.customPerms;

    const { rows } = await pool.query(
        `SELECT custom_permissions FROM staff WHERE user_id = $1 AND salon_id = $2 LIMIT 1`,
        [userId, salonId]
    );

    const customPerms = (rows[0]?.custom_permissions as Record<string, boolean> | null) ?? null;
    staffPermCache.set(userId, { customPerms, expiresAt: now + CACHE_TTL_MS });
    return customPerms;
}

export function invalidateStaffPermCache(userId: string) {
    staffPermCache.delete(userId);
}

// ── New roles/permissions tables (post-backfill resolution path) ───────────────
// See scripts/backfill-permissions-system.ts. A staff member resolves through
// this path once their `staff.role_id` has been populated; until then,
// staffHasPermission() below falls back to the legacy blob-based caches above,
// so this file works correctly whether or not the backfill has run yet in a
// given environment. Once every environment is backfilled, the legacy path
// (and these two comments) can be deleted — Phase 3 cleanup.

interface StaffRoleInfo {
    staffId: string;
    roleId: string | null;
}

// userId → { staffId, roleId, expiresAt }
const staffRoleCache = new Map<string, StaffRoleInfo & { expiresAt: number }>();

async function loadStaffRoleInfo(userId: string, salonId: string): Promise<StaffRoleInfo | null> {
    const now = Date.now();
    const cached = staffRoleCache.get(userId);
    if (cached && cached.expiresAt > now) return cached;

    const { rows } = await pool.query(
        `SELECT id, role_id FROM staff WHERE user_id = $1 AND salon_id = $2 LIMIT 1`,
        [userId, salonId]
    );
    if (!rows[0]) return null;

    const info = { staffId: rows[0].id as string, roleId: (rows[0].role_id as string) ?? null };
    staffRoleCache.set(userId, { ...info, expiresAt: now + CACHE_TTL_MS });
    return info;
}

export function invalidateStaffRoleCache(userId: string) {
    staffRoleCache.delete(userId);
}

// roleId → { permKey: allowed }
const rolePermissionsCache = new Map<string, { perms: Record<string, boolean>; expiresAt: number }>();

async function loadRolePermissions(roleId: string): Promise<Record<string, boolean>> {
    const now = Date.now();
    const cached = rolePermissionsCache.get(roleId);
    if (cached && cached.expiresAt > now) return cached.perms;

    const { rows } = await pool.query(
        `SELECT permission_key, allowed FROM role_permissions WHERE role_id = $1`,
        [roleId]
    );
    const perms: Record<string, boolean> = {};
    for (const row of rows) perms[row.permission_key] = row.allowed;

    rolePermissionsCache.set(roleId, { perms, expiresAt: now + CACHE_TTL_MS });
    return perms;
}

export function invalidateRolePermissionsCache(roleId: string) {
    rolePermissionsCache.delete(roleId);
}

// staffId → sparse { permKey: allowed } — only keys with an actual override row
const staffOverridesCache = new Map<string, { overrides: Record<string, boolean>; expiresAt: number }>();

async function loadStaffOverrides(staffId: string): Promise<Record<string, boolean>> {
    const now = Date.now();
    const cached = staffOverridesCache.get(staffId);
    if (cached && cached.expiresAt > now) return cached.overrides;

    const { rows } = await pool.query(
        `SELECT permission_key, allowed FROM staff_permission_overrides WHERE staff_id = $1`,
        [staffId]
    );
    const overrides: Record<string, boolean> = {};
    for (const row of rows) overrides[row.permission_key] = row.allowed;

    staffOverridesCache.set(staffId, { overrides, expiresAt: now + CACHE_TTL_MS });
    return overrides;
}

export function invalidateStaffOverridesCache(staffId: string) {
    staffOverridesCache.delete(staffId);
}

// ── Default staff permissions (used when nothing has been configured) ─────────
// Mirrors the "staff" column defaults in src/features/settings/data/permissionMatrix.ts
// on the frontend — keep the two in sync when adding a new requirePermission() key.
const DEFAULT_STAFF_PERMS: Record<string, boolean> = {
    // Marketing keys were missing from this map entirely, so any
    // requirePermission("view_campaigns") check fell through to `?? false` and
    // denied staff even when the frontend matrix said otherwise. Listed here
    // so the two sides actually agree.
    view_campaigns: false,
    create_campaigns: false,
    design_coupons: false,
    view_calendar: true,
    manage_calendar: false,
    view_appointment: true,
    create_appointment: false,
    edit_appointment: false,
    cancel_appointment: false,
    delete_appointment: false,
    view_payment_details: false,
    view_clients: true,
    create_clients: true,
    edit_clients: true,
    delete_clients: false,
    import_clients: false,
    export_clients: false,
    block_client: false,
    view_client_history: true,
    view_referral_rewards: false,
    view_sales: true,
    create_sales: true,
    import_sales: false,
    view_services: true,
    create_services: false,
    edit_services: false,
    delete_services: false,
    manage_categories: false,
    import_services: false,
    print_menu_card: false,
    download_service_menu_pdf: false,
    download_service_menu_excel: false,
    download_service_menu_csv: false,
    view_products: true,
    create_products: false,
    edit_products: false,
    delete_products: false,
    import_products: false,
    download_products_pdf: false,
    download_products_excel: false,
    download_products_csv: false,
    view_packages: true,
    create_packages: false,
    edit_packages: false,
    delete_packages: false,
    view_client_packages: true,
    create_package: false,
    edit_package: false,
    delete_package: false,
    view_package_templates: true,
    add_package_template: false,
    edit_package_template: false,
    delete_package_template: false,
    view_memberships: true,
    create_memberships: false,
    edit_memberships: false,
    delete_memberships: false,
    download_membership_pdf: false,
    download_membership_excel: false,
    download_membership_csv: false,
    view_inventory: true,
    manage_inventory: false,
    stock_adjustment: false,
    view_product_inventory: true,
    add_product: false,
    edit_product: false,
    delete_product: false,
    adjust_product_stock: false,
    view_product_stock_history: true,
    download_product_inventory_pdf: false,
    download_product_inventory_excel: false,
    download_product_inventory_csv: false,
    view_consumable_inventory: true,
    add_consumable: false,
    edit_consumable: false,
    adjust_consumable_stock: false,
    activate_deactivate_consumable: false,
    view_consumable_usage: true,
    download_consumable_inventory_pdf: false,
    download_consumable_inventory_excel: false,
    download_consumable_inventory_csv: false,
    view_product_audit: true,
    create_product_audit: false,
    approve_product_audit: false,
    export_product_audit_excel: false,
    view_stock_ledger: true,
    edit_stock_ledger: false,
    delete_stock_ledger: false,
    stock_ledger_adjustment: false,
    export_stock_ledger_excel: false,
    view_suppliers: true,
    create_suppliers: false,
    edit_suppliers: false,
    delete_suppliers: false,
    supplier_payout: false,
    view_orders: true,
    create_order: false,
    edit_order: false,
    cancel_order: false,
    receive_order: false,
    download_order_pdf: false,
    view_booking: true,
    manage_booking: false,
    view_team: true,
    add_team_member: false,
    edit_team_member: false,
    delete_staff: false,
    deactivate_staff: false,
    import_staff: false,
    export_staff_csv: false,
    export_staff_excel: false,
    export_staff_pdf: false,
    view_staff_history: true,
    manage_shifts: false,
    view_scheduled_shifts: true,
    add_working_hours: false,
    edit_working_hours: false,
    add_time_off: false,
    manage_day_off: false,
    manage_blocked_day: false,
    copy_schedule: false,
    view_commissions: false,
    add_commission_rule: false,
    edit_commission_rule: false,
    delete_commission_rule: false,
    view_tips: false,
    add_tip: false,
    edit_tip: false,
    delete_tip: false,
    download_commission_tip_csv: false,
    download_commission_tip_excel: false,
    download_commission_tip_pdf: false,
    view_attendance_list: true,
    view_attendance_rules: false,
    view_payroll: false,
    add_salary_advance: false,
    pay_salary: false,
    view_payroll_details: false,
    edit_payroll: false,
    delete_payroll: false,
    export_payroll: false,
    view_reports: false,
    export_reports: false,
    general_settings: false,
    manage_pos_payments: false,
    view_enquiries: true,
};

// ── Core resolver ──────────────────────────────────────────────────────────────
// Returns whether the given permKey is allowed for this staff member. Callers
// that already know the request is owner/admin (or don't need to short-circuit
// on missing salon context with a specific error) can use this directly.
// Exported so the anti-escalation check in roles.service.ts (a manage_roles
// holder can't grant a permission they don't themselves have) can reuse the
// exact same resolution logic instead of duplicating it. NOTE: this function
// does not itself check user.role — callers must not invoke it for
// owner/admin actors (who have no `staff` row to resolve against); the
// owner/admin bypass belongs at the call site, same as requirePermission()
// already does below.
export async function staffHasPermission(user: PermUser, permKey: string): Promise<boolean> {
    const salonId = user.salonId;
    if (!salonId) return false;

    const roleInfo = await loadStaffRoleInfo(user.userId, salonId);

    if (roleInfo?.roleId) {
        // ── New path: staff.role_id has been backfilled for this staff member ──
        // 1. Sparse per-staff override wins outright if a row exists for this key.
        const overrides = await loadStaffOverrides(roleInfo.staffId);
        if (permKey in overrides) {
            if (permKey.startsWith("view_dashboard") || permKey === "view_calendar") {
                logger.warn("[DEBUG staffHasPermission] override hit", { userId: user.userId, salonId, staffId: roleInfo.staffId, roleId: roleInfo.roleId, permKey, value: overrides[permKey] });
            }
            return overrides[permKey];
        }

        // 2. Otherwise fall through to the assigned role's permission set.
        // A key with no row here means "not explicitly granted" and must
        // resolve to false — NOT fall back to the legacy DEFAULT_STAFF_PERMS
        // map. That fallback only belongs in the legacy path below (for
        // salons that predate this system entirely); once a staff member has
        // a real role_id, an unconfigured permission is a deliberate deny,
        // otherwise a freshly-created blank role would silently leak every
        // legacy "true by default" permission it never actually granted.
        const rolePerms = await loadRolePermissions(roleInfo.roleId);
        if (permKey.startsWith("view_dashboard") || permKey === "view_calendar") {
            logger.warn("[DEBUG staffHasPermission] role-default hit", { userId: user.userId, salonId, staffId: roleInfo.staffId, roleId: roleInfo.roleId, permKey, value: rolePerms[permKey] ?? false, overrideKeys: Object.keys(overrides) });
        }
        return rolePerms[permKey] ?? false;
    }

    if (permKey.startsWith("view_dashboard") || permKey === "view_calendar") {
        logger.warn("[DEBUG staffHasPermission] legacy path (no role_id)", { userId: user.userId, salonId, permKey });
    }

    // ── Legacy path: this staff member hasn't been backfilled yet (or the
    // backfill script hasn't been run in this environment) — resolve exactly
    // as before so behavior is unchanged until the migration actually runs.
    // Safe to delete once every environment is confirmed backfilled (Phase 3).
    const customPerms = await loadStaffCustomPerms(user.userId, salonId);
    if (customPerms !== null) {
        return customPerms[permKey] ?? false;
    }

    const rolePerms = await loadRolePerms(salonId);
    return Object.keys(rolePerms).length > 0
        ? (rolePerms[permKey]?.staff ?? false)
        : (DEFAULT_STAFF_PERMS[permKey] ?? false);
}

// ── Effective permissions for the current user (used by GET /users/me) ─────────
// Computes the full { permKey: boolean } map for a staff user using the exact
// same resolution as staffHasPermission() above — the frontend's usePermissions()
// hook consumes this directly instead of maintaining its own separate,
// drift-prone copy of the resolution logic. owner/admin never need this (they
// bypass everywhere), so callers should only call it for role === "staff".
export async function getEffectivePermissionsForUser(
    userId: string,
    salonId: string,
    allKeys: string[]
): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const key of allKeys) {
        result[key] = await staffHasPermission({ userId, role: "staff", salonId }, key);
    }
    return result;
}

// ── Middleware factory ────────────────────────────────────────────────────────
export const requirePermission = (permKey: string) =>
    async (req: Request & { user?: PermUser }, _res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));

            // Owners and admins always pass through
            if (user.role === "salon_owner" || user.role === "admin") return next();

            if (user.role === "staff") {
                if (!user.salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

                const allowed = await staffHasPermission(user, permKey);
                if (!allowed) {
                    return next(new AppError(
                        403,
                        `You do not have permission to perform this action (${permKey})`,
                        "FORBIDDEN"
                    ));
                }
            }

            return next();
        } catch (err) {
            return next(err);
        }
    };

// ── Middleware factory (export-format-aware) ───────────────────────────────────
// A handful of export endpoints serve csv/excel/pdf from one route via
// ?format=..., rather than three separate routes — so the permission to
// check can't be picked statically at route-registration time. Mirrors each
// controller's own format parsing/defaulting exactly, so the permission
// checked always matches the file actually generated.
//
// `formatToKey` lets a caller remap a query value that isn't literally
// "pdf"/"excel"/"csv" onto the right permission — e.g. staff commissions'
// export endpoint uses ?format=json to fetch rows for a client-side PDF
// build (same pattern as the Reports module's ReportExportButton), which
// should still require export_pdf, not a nonexistent "export_json".
export const requireExportFormatPermission = (
    allowedFormats: string[] = ["csv", "excel", "pdf"],
    defaultFormat: string = "csv",
    formatToKey: Record<string, "csv" | "excel" | "pdf"> = {}
) =>
    (req: Request & { user?: PermUser }, res: Response, next: NextFunction) => {
        const raw = String(req.query.format || "").toLowerCase();
        const format = allowedFormats.includes(raw) ? raw : defaultFormat;
        const resolved = formatToKey[format] ?? (format as "csv" | "excel" | "pdf");
        const key = resolved === "pdf" ? "export_pdf" : resolved === "excel" ? "export_excel" : "export_csv";
        return requirePermission(key)(req, res, next);
    };

// ── Middleware factory (any-of) ────────────────────────────────────────────────
// Passes if the staff member has AT LEAST ONE of the given keys. Use this for
// reads that multiple independent features legitimately depend on — e.g. Quick
// Sale and the Calendar both need to read the product/membership catalog to
// build a sale or appointment, even for staff who weren't separately granted
// Catalog view permissions.
export const requireAnyPermission = (permKeys: string[]) =>
    async (req: Request & { user?: PermUser }, _res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));

            if (user.role === "salon_owner" || user.role === "admin") return next();

            if (user.role === "staff") {
                if (!user.salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

                for (const key of permKeys) {
                    if (await staffHasPermission(user, key)) return next();
                }
                return next(new AppError(
                    403,
                    `You do not have permission to perform this action (${permKeys.join(" / ")})`,
                    "FORBIDDEN"
                ));
            }

            return next();
        } catch (err) {
            return next(err);
        }
    };
