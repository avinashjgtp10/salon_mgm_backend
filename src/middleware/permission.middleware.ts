import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { AppError } from "./error.middleware";

interface PermUser {
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
};

// ── Core resolver ──────────────────────────────────────────────────────────────
// Returns whether the given permKey is allowed for this staff member. Callers
// that already know the request is owner/admin (or don't need to short-circuit
// on missing salon context with a specific error) can use this directly.
async function staffHasPermission(user: PermUser, permKey: string): Promise<boolean> {
    const salonId = user.salonId;
    if (!salonId) return false;

    // 1. Check per-staff custom permissions first
    const customPerms = await loadStaffCustomPerms(user.userId, salonId);
    if (customPerms !== null) {
        return customPerms[permKey] ?? false;
    }

    // 2. Fall back to global role-level permissions
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
