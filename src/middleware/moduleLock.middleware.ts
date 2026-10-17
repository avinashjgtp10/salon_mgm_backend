import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import logger from "../config/logger";
import { AppError } from "./error.middleware";
import {
    expandLockedKeys,
    MODULE_LOCKED_MESSAGE,
    type ModuleKey,
} from "../modules/salon-modules/module-keys";

interface LockUser {
    userId: string;
    role?: string;
    salonId?: string | null;
}

// Per-salon module locks set by Super Admin (Salon Customization). This is a
// SALON-level axis, separate from staff permissions (permission.middleware.ts):
// it applies to the owner too, since it's the salon's entitlement being
// checked, not who is logged in. A salon with no lock rows has everything on.
const CACHE_TTL_MS = 60_000;
const lockCache = new Map<string, { keys: Set<string>; expiresAt: number }>();
let warnedMissingTable = false;

export async function loadLockedModules(salonId: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = lockCache.get(salonId);
    if (cached && cached.expiresAt > now) return cached.keys;

    let keys: Set<string>;
    try {
        const { rows } = await pool.query(
            `SELECT module_key FROM salon_module_locks WHERE salon_id = $1`,
            [salonId]
        );
        keys = expandLockedKeys(rows.map((r) => r.module_key as string));
    } catch (err: any) {
        // Migration not run on this database yet — behave as "nothing locked"
        // instead of failing every gated request.
        if (err?.code !== "42P01") throw err;
        if (!warnedMissingTable) {
            warnedMissingTable = true;
            logger.warn("salon_module_locks table missing — module locks are not enforced until the migration is run");
        }
        keys = new Set<string>();
    }

    lockCache.set(salonId, { keys, expiresAt: now + CACHE_TTL_MS });
    return keys;
}

export async function isModuleLocked(salonId: string, key: ModuleKey): Promise<boolean> {
    return (await loadLockedModules(salonId)).has(key);
}

// Throws the standard locked error — for service-level checks where a
// route-prefix gate can't see the module (e.g. package items inside a sale).
export async function assertModuleUnlocked(salonId: string | null | undefined, key: ModuleKey): Promise<void> {
    if (!salonId) return;
    if (await isModuleLocked(salonId, key)) throw moduleLockedError(key);
}

export function moduleLockedError(key: ModuleKey): AppError {
    return new AppError(403, MODULE_LOCKED_MESSAGE, "MODULE_LOCKED", { module: key });
}

// Applies on this instance immediately; other instances within CACHE_TTL_MS.
export function invalidateModuleLockCache(salonId: string) {
    lockCache.delete(salonId);
}

// Gates a route (tree) behind a module. Super admins bypass — they aren't a
// "salon". Staff inherit their salon's locks the same as the owner.
export const requireModule = (key: ModuleKey) =>
    async (req: Request & { user?: LockUser }, _res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
            if (user.role === "super_admin") return next();

            const salonId = user.salonId;
            if (!salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

            if (await isModuleLocked(salonId, key)) return next(moduleLockedError(key));
            return next();
        } catch (err) {
            return next(err);
        }
    };
