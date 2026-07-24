import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { AppError } from "./error.middleware";

interface PermUser {
    userId: string;
    role?: string;
    salonId?: string | null;
}

// The 7 subscription-related actions a super admin can grant/revoke per
// salon. Renew/Upgrade/Downgrade currently all funnel through the same
// POST /api/v1/subscriptions endpoint (this codebase has no separate route
// per action) — all three keys are checked together on that one route until
// distinct flows exist. Manage Payment Methods has no backing endpoint yet
// (no payment-methods CRUD in this codebase) — the key is stored/toggleable
// from the super admin UI for completeness, but nothing currently enforces it.
export type SubscriptionPermissionKey =
    | "view_subscription"
    | "renew_subscription"
    | "upgrade_subscription"
    | "downgrade_subscription"
    | "cancel_subscription"
    | "view_billing_history"
    | "manage_payment_methods";

export const SUBSCRIPTION_PERMISSION_KEYS: SubscriptionPermissionKey[] = [
    "view_subscription",
    "renew_subscription",
    "upgrade_subscription",
    "downgrade_subscription",
    "cancel_subscription",
    "view_billing_history",
    "manage_payment_methods",
];

// Nothing configured yet = everything allowed, so existing salons aren't
// suddenly locked out of subscription actions the moment this feature ships.
const DEFAULT_ALLOWED = true;

const CACHE_TTL_MS = 60_000;

// salonId → { perms, expiresAt } — separate cache from permission.middleware's
// rolePermCache since this is a different setting key / different axis
// (account-level subscription actions, not staff role permissions).
const subscriptionPermCache = new Map<string, {
    perms: Record<string, boolean>;
    expiresAt: number;
}>();

async function loadSubscriptionPerms(salonId: string): Promise<Record<string, boolean>> {
    const now = Date.now();
    const cached = subscriptionPermCache.get(salonId);
    if (cached && cached.expiresAt > now) return cached.perms;

    const { rows } = await pool.query(
        `SELECT value FROM salon_settings WHERE salon_id = $1 AND key = 'subscription_permissions' LIMIT 1`,
        [salonId]
    );

    let perms: Record<string, boolean> = {};
    if (rows[0]?.value) {
        try {
            perms = JSON.parse(rows[0].value);
        } catch {
            perms = {};
        }
    }

    subscriptionPermCache.set(salonId, { perms, expiresAt: now + CACHE_TTL_MS });
    return perms;
}

// Applies immediately (within CACHE_TTL_MS, or instantly if the super admin
// save path calls this) — no JWT re-issue or logout required, since every
// check re-reads salon_settings per request rather than trusting anything
// baked into the access token at login time.
export function invalidateSubscriptionPermCache(salonId: string) {
    subscriptionPermCache.delete(salonId);
}

// Unlike requirePermission()/requireAnyPermission() (which only ever
// restrict staff — salon_owner/admin always pass through), this middleware
// applies to owner/admin too. Its whole purpose is letting a super admin
// restrict what the ACCOUNT itself (owner included) can do with its own
// subscription — a different axis from staff-vs-owner permissioning.
export const requireSubscriptionPermission = (key: SubscriptionPermissionKey) =>
    async (req: Request & { user?: PermUser }, _res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));

            // Super admins themselves are never subject to a salon's own
            // subscription permission grid.
            if (user.role === "super_admin") return next();

            const salonId = user.salonId;
            if (!salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

            const perms = await loadSubscriptionPerms(salonId);
            const allowed = Object.prototype.hasOwnProperty.call(perms, key) ? perms[key] : DEFAULT_ALLOWED;
            if (!allowed) {
                return next(new AppError(
                    403,
                    `Your salon does not have permission to perform this action (${key})`,
                    "SUBSCRIPTION_ACTION_FORBIDDEN"
                ));
            }

            return next();
        } catch (err) {
            return next(err);
        }
    };
