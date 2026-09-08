import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { AppError } from "./error.middleware";

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
    view_clients: true,
    create_clients: true,
    edit_clients: true,
    delete_clients: false,
    view_sales: true,
    create_sales: true,
    view_services: true,
    create_services: false,
    edit_services: false,
    view_products: true,
    create_products: false,
    view_packages: true,
    create_packages: false,
    view_memberships: true,
    create_memberships: false,
    view_inventory: true,
    manage_inventory: false,
    stock_adjustment: false,
    view_booking: true,
    manage_booking: false,
    view_team: true,
    add_team_member: false,
    edit_team_member: false,
    manage_shifts: false,
    view_payroll: false,
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
        if (permKey in overrides) return overrides[permKey];

        // 2. Otherwise fall through to the assigned role's permission set.
        const rolePerms = await loadRolePermissions(roleInfo.roleId);
        return rolePerms[permKey] ?? DEFAULT_STAFF_PERMS[permKey] ?? false;
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
