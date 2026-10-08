import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { AppError } from "./error.middleware";
import { mobileCalendarAccessGrants } from "../modules/mobile-staff/mobileCalendarAccess";

export interface PermUser {
    userId: string;
    role?: string;
    salonId?: string | null;
}

const CACHE_TTL_MS = 60_000; // 1 minute

// Legacy salon_settings 'role_permissions' blob is no longer consulted; kept so
// existing callers (settings.controller.ts) don't need to change.
export function invalidatePermissionCache(_salonId: string) {}

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
            return overrides[permKey];
        }

        // 2. Otherwise fall through to the assigned role's permission set.
        // A key with no row here means "not explicitly granted" and resolves
        // to false — an unconfigured permission is a deliberate deny.
        const rolePerms = await loadRolePermissions(roleInfo.roleId);
        return rolePerms[permKey] ?? false;
    }

    // ── Legacy path: this staff member hasn't been backfilled yet. Only their
    // own custom_permissions blob is honoured; there are no built-in defaults.
    // Safe to delete once every environment is confirmed backfilled.
    const customPerms = await loadStaffCustomPerms(user.userId, salonId);
    if (customPerms !== null && permKey in customPerms) {
        return customPerms[permKey];
    }

    // No built-in defaults: anything not explicitly granted is denied.
    return false;
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

                // The mobile-only Calendar & Quick Sale switch can grant a
                // subset of keys — see mobile-staff/mobileCalendarAccess.ts.
                const allowed = await staffHasPermission(user, permKey)
                    || await mobileCalendarAccessGrants(req, [permKey]);
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
                if (await mobileCalendarAccessGrants(req, permKeys)) return next();
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
