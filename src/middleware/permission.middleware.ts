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
const DEFAULT_STAFF_PERMS: Record<string, boolean> = {
    view_dashboard: true,
    view_appointments: true,
    create_appointments: true,
    view_clients: true,
    view_sales: true,
    create_sales: true,
    view_catalog: true,
};

// ── Middleware factory ────────────────────────────────────────────────────────
export const requirePermission = (permKey: string) =>
    async (req: Request & { user?: PermUser }, _res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));

            // Owners and admins always pass through
            if (user.role === "salon_owner" || user.role === "admin") return next();

            if (user.role === "staff") {
                const salonId = user.salonId;
                if (!salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

                // 1. Check per-staff custom permissions first
                const customPerms = await loadStaffCustomPerms(user.userId, salonId);
                if (customPerms !== null) {
                    const allowed = customPerms[permKey] ?? false;
                    if (!allowed) {
                        return next(new AppError(
                            403,
                            `You do not have permission to perform this action (${permKey})`,
                            "FORBIDDEN"
                        ));
                    }
                    return next();
                }

                // 2. Fall back to global role-level permissions
                const rolePerms = await loadRolePerms(salonId);
                const allowed =
                    Object.keys(rolePerms).length > 0
                        ? (rolePerms[permKey]?.staff ?? false)
                        : (DEFAULT_STAFF_PERMS[permKey] ?? false);

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
