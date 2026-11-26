import logger from '../config/logger';
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { getSalonId } from "../modules/utils/salon.util";

const EXEMPT_PREFIXES = [
    "/api/v1/auth",
    "/api/v1/oauth",
    "/api/v1/billing",
    "/api/v1/subscriptions",
    "/api/v1/webhooks",
    "/api/v1/profile",
    "/api/v1/users/me",
    "/api/v1/users/profile",
    "/api-docs",
];

function isExempt(path: string): boolean {
    return EXEMPT_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(prefix + "/")
    );
}

const BLOCKED = {
    success: false,
    error: {
        code: "SUBSCRIPTION_REQUIRED",
        message: "Your subscription has expired or is inactive. Please renew your plan to continue.",
    },
};

// Server-side blocking for expired plans, across the whole API. OFF unless SUBSCRIPTION_ENFORCEMENT=true, so it can be tested
// before it affects anyone. It runs before the routes' own authMiddleware, so it reads the login token itself; a request with
// no valid token is passed on untouched (public routes stay public, protected ones reject it as they always have).
const ENFORCEMENT_EXEMPT = ["/api/v1/super-admin", "/api/v1/salons"];   // the app needs the salon itself to show the renewal screen

export const subscriptionEnforcementEnabled = () => String(process.env.SUBSCRIPTION_ENFORCEMENT ?? "").trim().toLowerCase() === "true";

export async function enforceSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
    if (!subscriptionEnforcementEnabled()) return next();
    if (isExempt(req.path) || ENFORCEMENT_EXEMPT.some((p) => req.path === p || req.path.startsWith(p + "/"))) return next();

    const [type, token] = String(req.headers.authorization ?? "").split(" ");
    const secret = process.env.JWT_ACCESS_SECRET;
    if (type !== "Bearer" || !token || !secret) return next();
    let user: any;
    try {
        user = jwt.verify(token, secret);
    } catch {
        return next();
    }
    // Neither of these has a plan of their own. (A branch owner who has entered a salon carries its salonId and is checked.)
    if (user.role === "super_admin" || (user.role === "branch_owner" && !user.salonId)) return next();

    req.user = user;
    await subscriptionMiddleware(req, res, () => {
        delete req.user;   // the route's own authMiddleware sets it again, after its session checks
        next();
    });
}

export async function subscriptionMiddleware(
    req: Request & { user?: { userId: string; role?: string; salonId?: string | null } },
    res: Response,
    next: NextFunction
): Promise<void> {
    if (!req.user) return next();
    if (isExempt(req.path)) return next();
    if (req.user.role === "admin") return next();

    let salonId: string | null | undefined = req.user.salonId;
    if (!salonId) {
        salonId = await getSalonId(req).catch(() => null);
    }
    if (!salonId) {
        res.status(403).json(BLOCKED);
        return;
    }

    try {
        // Check subscriptions table (subscriptions table). A trial ends on trial_end when it has no current_period_end.
        const { rows: subRows } = await pool.query(
            `SELECT id, status, current_period_end
             FROM subscriptions
             WHERE salon_id = $1
               AND status IN ('active', 'trialing')
               AND COALESCE(CASE WHEN is_trial OR status = 'trialing' THEN COALESCE(trial_end, current_period_end) ELSE current_period_end END,
                            'infinity') > NOW()
             ORDER BY created_at DESC
             LIMIT 1`,
            [salonId]
        );

        if (subRows.length > 0) return next();

        // Check billing_subscriptions table (legacy / manual)
        const { rows: billingRows } = await pool.query<{
            status: string;
            trial_ends_at: Date | null;
        }>(
            `SELECT status, trial_ends_at
             FROM billing_subscriptions
             WHERE salon_id = $1
               AND status IN ('trialing', 'active')
             ORDER BY created_at DESC
             LIMIT 1`,
            [salonId]
        );

        if (billingRows.length === 0) {
            res.status(403).json(BLOCKED);
            return;
        }

        const sub = billingRows[0];

        // Check trial expiry
        if (sub.status === "trialing" && sub.trial_ends_at) {
            if (new Date() > new Date(sub.trial_ends_at)) {
                await pool.query(
                    `UPDATE billing_subscriptions
                     SET status = 'inactive', updated_at = NOW()
                     WHERE salon_id = $1 AND status = 'trialing' AND trial_ends_at < NOW()`,
                    [salonId]
                ).catch((err) => logger.error("[subscriptionMiddleware] expire trial error:", err));

                res.status(403).json(BLOCKED);
                return;
            }
        }

        next();
    } catch (err) {
        logger.error("[subscriptionMiddleware] DB error:", err);
        res.status(503).json({
            success: false,
            error: {
                code: "SERVICE_UNAVAILABLE",
                message: "Subscription check failed. Please try again later.",
            },
        });
    }
}