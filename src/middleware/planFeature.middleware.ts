import { Request, Response, NextFunction } from "express";
import pool from "../config/database";
import { AppError } from "./error.middleware";

interface PlanUser {
    userId: string;
    role?: string;
    salonId?: string | null;
}

// A salon's effective feature set, keyed by stable snake_case featureKey
// (e.g. "inventory", "marketing") — salon_plan_definitions.feature_keys is a
// JSONB array of {key, label} objects, NOT the same list as the
// admin-editable pricing-card marketing copy in .features (different count,
// different wording — see Migration/fix_feature_keys_shape.sql for why they
// were split apart). This middleware only ever reads .key; .label is
// display-only, read by the super-admin UI.
//
// Effective set = base tier's cumulative feature_keys (Basic, or
// Basic+Advance, or Basic+Advance+Pro) with per-salon feature_overrides from
// salon_plan_customizations layered on top — an override can both grant a
// key the base tier lacks (true) and revoke one it has (false). A salon with
// no customization row yet runs the Basic tier's plain defaults (mirrors
// salon-plans.service.ts getCustomization's same "no row = Basic" fallback).
const TIER_ORDER = ["basic", "advance", "pro"];

const CACHE_TTL_MS = 60_000;

// salonId → { keys: Set<featureKey>, expiresAt } — separate cache from
// subscriptionPermCache (different table, different axis: module/feature
// access vs. subscription-management actions).
const featureCache = new Map<string, { keys: Set<string>; expiresAt: number }>();

// The ONE centralized function every enforcement point (backend middleware,
// the /my-features endpoint the frontend's hasFeature() hook reads, route
// guards) ultimately calls — single source of truth for "does this salon
// have featureKey X right now," per the "ONE centralized subscription
// permission function" requirement.
export async function hasFeature(salonId: string, featureKey: string): Promise<boolean> {
    const keys = await loadSalonFeatureKeys(salonId);
    return keys.has(featureKey);
}

export async function loadSalonFeatureKeys(salonId: string): Promise<Set<string>> {
    const now = Date.now();
    const cached = featureCache.get(salonId);
    if (cached && cached.expiresAt > now) return cached.keys;

    const { rows: customRows } = await pool.query(
        `SELECT base_tier, feature_overrides FROM salon_plan_customizations WHERE salon_id = $1`,
        [salonId]
    );
    const baseTier: string = customRows[0]?.base_tier ?? "basic";
    const overrides: Record<string, boolean> = customRows[0]?.feature_overrides ?? {};

    const tierIdx = TIER_ORDER.indexOf(baseTier);
    const cumulativeTiers = TIER_ORDER.slice(0, tierIdx + 1);

    const { rows: defRows } = await pool.query(
        `SELECT feature_keys FROM salon_plan_definitions WHERE tier = ANY($1::text[])`,
        [cumulativeTiers]
    );

    const keys = new Set<string>(
        defRows.flatMap((r) => (r.feature_keys as { key: string; label: string }[]).map((f) => f.key))
    );
    for (const [key, on] of Object.entries(overrides)) {
        if (on) keys.add(key);
        else keys.delete(key);
    }

    featureCache.set(salonId, { keys, expiresAt: now + CACHE_TTL_MS });
    return keys;
}

// Applies within CACHE_TTL_MS of a super-admin customization save (or
// instantly if that save path calls this) — same reasoning as
// invalidateSubscriptionPermCache: every check re-reads the DB per request
// rather than trusting anything baked into the JWT at login time.
export function invalidatePlanFeatureCache(salonId: string) {
    featureCache.delete(salonId);
}

// A plan DEFINITION change (e.g. removing a key from Advance) affects every
// salon on that tier at once, not just one salon_id — cheapest correct fix
// is to drop the whole cache rather than track which salons are on which
// tier here too.
export function invalidateAllPlanFeatureCaches() {
    featureCache.clear();
}

// Gates a route behind one of the featureKeys in salon_plan_definitions
// (e.g. "inventory", "marketing", "payroll"). Super admins bypass this
// entirely — they aren't a "salon" and have no plan of their own. Staff
// inherit their salon's plan the same as the owner; this is a salon-level
// gate, not a per-user one (see permission.middleware.ts for that axis).
export const requirePlanFeature = (featureKey: string) =>
    async (req: Request & { user?: PlanUser }, _res: Response, next: NextFunction) => {
        try {
            const user = req.user;
            if (!user?.userId) return next(new AppError(401, "Unauthorized", "UNAUTHORIZED"));
            if (user.role === "super_admin") return next();

            const salonId = user.salonId;
            if (!salonId) return next(new AppError(403, "No salon context", "FORBIDDEN"));

            const allowed = await hasFeature(salonId, featureKey);
            if (!allowed) {
                return next(new AppError(
                    403,
                    `Your salon's plan does not include this feature. Upgrade your plan to access it.`,
                    "PLAN_FEATURE_LOCKED",
                    { feature: featureKey }
                ));
            }

            return next();
        } catch (err) {
            return next(err);
        }
    };
