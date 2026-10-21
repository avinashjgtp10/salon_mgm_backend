// Plan identity helpers shared by the billing view and the upgrade flow. A subscription points at a subscription_plans row;
// that row's `tier` (basic / advance / growth, set by the Plans page) and `billing_cycle` say which plan it is.

export const TIERS = ["basic", "advance", "growth"] as const;
export type Tier = (typeof TIERS)[number];

export const CYCLES = ["monthly", "quarterly", "yearly"] as const;
export type Cycle = (typeof CYCLES)[number];

export const CYCLE_MONTHS: Record<Cycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };
export const TIER_RANK: Record<Tier, number> = { basic: 1, advance: 2, growth: 3 };

export const tierRank = (t: Tier | null | undefined): number => (t ? TIER_RANK[t] : 0);

export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);
export const isCycle = (v: unknown): v is Cycle => typeof v === "string" && (CYCLES as readonly string[]).includes(v);

/** Older rows say "annual"; everything else already uses monthly / quarterly / yearly. */
export function normalizeCycle(v: unknown): Cycle | null {
    if (v === "annual") return "yearly";
    return isCycle(v) ? v : null;
}

/**
 * Which of Basic / Advance / Growth a plan row is. The `tier` column is authoritative; older rows that predate it are
 * recognised by name ("SalonOx Pro" was the top plan, so it counts as Growth). Anything else (a manual-grant or test plan)
 * has no tier.
 */
export function tierOfPlan(plan: { tier?: string | null; name?: string | null; slug?: string | null }): Tier | null {
    if (isTier(plan.tier)) return plan.tier;
    const text = `${plan.name ?? ""} ${plan.slug ?? ""}`.toLowerCase();
    if (/\bgrowth\b|\bpro\b/.test(text)) return "growth";
    if (/advance/.test(text)) return "advance";
    if (/basic/.test(text)) return "basic";
    return null;
}

/** `from` plus one billing cycle, in calendar months (a month from 31 Jan is 28/29 Feb, not 3 Mar). */
export function addCycle(from: Date, cycle: Cycle): Date {
    const d = new Date(from.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + CYCLE_MONTHS[cycle]);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}

/**
 * The pool returns timestamps as raw strings ("2026-10-31 12:00:00", no zone; see config/database.ts) and the session runs in UTC,
 * so they must be read as UTC. new Date() on such a string would use the server's local zone and shift dates by hours.
 */
export function dbDate(v: unknown): Date | null {
    if (v == null) return null;
    if (v instanceof Date) return v;
    const s = String(v);
    const d = new Date(/[zZ]|[+-]\d{2}(:?\d{2})?$/.test(s) ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}
