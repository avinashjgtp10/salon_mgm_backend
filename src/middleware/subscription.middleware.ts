import { Request, Response, NextFunction } from "express";
import pool from "../config/database";

const EXEMPT_PREFIXES = [
    "/api/v1/auth",
    "/api/v1/oauth",
    "/api/v1/billing",
    "/api/v1/subscriptions",
    "/api/v1/webhooks",
    "/api/v1/profile",
    "/api/v1/users/me",
];

function isExempt(path: string): boolean {
    return EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const BLOCKED = {
    success: false,
    error: {
        code: "SUBSCRIPTION_REQUIRED",
        message: "Your subscription has expired or is inactive. Please renew your plan to continue.",
    },
};

export async function subscriptionMiddleware(
    req: Request & { user?: { userId: string; role?: string; salonId?: string | null } },
    res: Response,
    next: NextFunction
): Promise<void> {
    if (!req.user) return next();
    if (isExempt(req.path)) return next();
    if (req.user.role === "admin") return next();

    const salonId = req.user.salonId;
    if (!salonId) return next();

    try {
        // Check subscriptions table (Razorpay hosted — new flow)
        const { rows: subRows } = await pool.query(
            `SELECT id, status, current_period_end
             FROM subscriptions
             WHERE salon_id = $1
               AND status = 'active'
               AND (current_period_end IS NULL OR current_period_end > NOW())
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
                pool.query(
                    `UPDATE billing_subscriptions
                     SET status = 'inactive', updated_at = NOW()
                     WHERE salon_id = $1 AND status = 'trialing' AND trial_ends_at < NOW()`,
                    [salonId]
                ).catch((err) => console.error("[subscriptionMiddleware] expire trial error:", err));

                res.status(403).json(BLOCKED);
                return;
            }
        }

        next();
    } catch (err) {
        console.error("[subscriptionMiddleware] DB error:", err);
        next(); // fail open
    }
}