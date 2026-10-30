import { CYCLE_MONTHS, tierRank, addCycle, type Cycle, type Tier } from "../subscription-billing/plan-tier";
import type { UpgradePolicy } from "./upgrade-policy";

// Pure upgrade pricing: no database, no clock of its own, no Razorpay. Everything is whole paise. See upgrade-policy.ts for
// the rules this implements.

const DAY_MS = 86_400_000;

export type PlanRelation = "current" | "upgrade" | "change";

export interface CurrentPlanFacts {
    tier: Tier | null;
    cycle: Cycle;
    periodStart: Date;
    periodEnd: Date;
    /** What the salon actually paid for this subscription BEFORE GST, in paise (0 if nothing was recorded). */
    paidSubtotalPaise: number;
}

export interface TargetPlanFacts {
    tier: Tier;
    cycle: Cycle;
    /** The plan's list price for that cycle BEFORE GST, in paise. */
    pricePaise: number;
}

export interface UpgradeQuote {
    kind: "upgrade" | "term_change";
    periodStart: Date;
    periodEnd: Date;
    totalDays: number;
    remainingDays: number;
    currentPaidPaise: number;
    newPlanChargePaise: number;
    creditAppliedPaise: number;
    /** Credit earned but not usable because it exceeds the new charge; not refunded. */
    unusedCreditPaise: number;
    subtotalPaise: number;
    gstPercent: number;
    gstPaise: number;
    totalPaise: number;
    zeroPayable: boolean;
}

export class UpgradeError extends Error {
    constructor(public code: "SAME_PLAN" | "NOT_AN_UPGRADE" | "EXPIRED" | "INVALID", message: string) {
        super(message);
    }
}

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const fromPaise = (paise: number) => paise / 100;

/**
 * How a target plan relates to the current one:
 *   current  - the same plan and cycle
 *   upgrade  - a higher tier, or the same tier on a longer billing cycle
 *   change   - anything else (a lower tier, or the same tier on a shorter cycle): takes effect at the next renewal
 * With no known current tier (e.g. a manually granted plan) every real plan counts as an upgrade.
 */
export function relationOf(current: { tier: Tier | null; cycle: Cycle } | null, target: { tier: Tier; cycle: Cycle }): PlanRelation {
    if (!current) return "upgrade";
    if (current.tier === target.tier && current.cycle === target.cycle) return "current";
    if (tierRank(target.tier) > tierRank(current.tier)) return "upgrade";
    if (tierRank(target.tier) === tierRank(current.tier) && CYCLE_MONTHS[target.cycle] > CYCLE_MONTHS[current.cycle]) return "upgrade";
    return "change";
}

/**
 * The same quote expressed in another currency (two-decimal currencies only; `rate` = units of that currency per 1 INR).
 * Meant for a quote that was calculated with gstPercent 0: an overseas customer is charged the converted amount with no Indian GST added,
 * exactly like a new subscription in that currency (subscription-pricing). Every line is converted on its own and the subtotal is rebuilt
 * from the converted lines, so the displayed lines always add up to the amount charged.
 */
export function convertUpgradeQuote(q: UpgradeQuote, rate: number): UpgradeQuote {
    if (!(rate > 0)) throw new UpgradeError("INVALID", "No exchange rate is available for that currency.");
    const conv = (paise: number) => Math.round(paise * rate);
    const newPlanChargePaise = conv(q.newPlanChargePaise);
    const creditAppliedPaise = Math.min(conv(q.creditAppliedPaise), newPlanChargePaise);
    const subtotalPaise = newPlanChargePaise - creditAppliedPaise;
    return {
        ...q,
        currentPaidPaise: conv(q.currentPaidPaise),
        newPlanChargePaise,
        creditAppliedPaise,
        // Earned credit (applied + unused, in INR) converted, minus what was applied.
        unusedCreditPaise: Math.max(0, conv(q.creditAppliedPaise + q.unusedCreditPaise) - creditAppliedPaise),
        subtotalPaise,
        gstPercent: 0,
        gstPaise: 0,
        totalPaise: subtotalPaise,
        zeroPayable: subtotalPaise === 0,
    };
}

export function calculateUpgradeQuote(input: {
    now: Date;
    current: CurrentPlanFacts;
    target: TargetPlanFacts;
    gstPercent: number;
    policy: UpgradePolicy;
}): UpgradeQuote {
    const { now, current, target, gstPercent, policy } = input;

    const relation = relationOf({ tier: current.tier, cycle: current.cycle }, target);
    if (relation === "current") throw new UpgradeError("SAME_PLAN", "That is already your current plan.");
    if (relation === "change") {
        throw new UpgradeError("NOT_AN_UPGRADE", "That plan is a lower plan, so it takes effect when your current plan renews.");
    }
    if (!(target.pricePaise > 0)) throw new UpgradeError("INVALID", "That plan has no price set.");

    const periodMs = current.periodEnd.getTime() - current.periodStart.getTime();
    const remainingMs = current.periodEnd.getTime() - now.getTime();
    if (!(remainingMs > 0)) {
        throw new UpgradeError("EXPIRED", "Your subscription has expired. Renew it to continue.");
    }
    const totalDays = Math.max(1, Math.round(periodMs / DAY_MS));
    // At least one day, and never more than the period (e.g. an upgrade bought minutes after the start).
    const remainingDays = Math.min(totalDays, Math.max(1, Math.ceil(remainingMs / DAY_MS)));

    const sameCycle = current.cycle === target.cycle;
    const kind: UpgradeQuote["kind"] = sameCycle ? "upgrade" : "term_change";

    // Rule 3 / 4: what period the salon will have after paying, and what the new plan costs for it.
    const periodStart = now;
    const periodEnd = sameCycle ? current.periodEnd : addCycle(now, target.cycle);
    const newPlanChargePaise = sameCycle
        ? Math.round((target.pricePaise * remainingDays) / totalDays)
        : target.pricePaise;

    // Rule 1 / 2: credit for the unused part of what was actually paid.
    const earnedCreditPaise = policy.creditUnusedValue
        ? Math.round((current.paidSubtotalPaise * remainingDays) / totalDays)
        : 0;
    const creditAppliedPaise = Math.min(earnedCreditPaise, newPlanChargePaise);   // rule 5
    const unusedCreditPaise = earnedCreditPaise - creditAppliedPaise;

    // Rule 6: GST on the taxable value that remains.
    const subtotalPaise = newPlanChargePaise - creditAppliedPaise;
    const gstPaise = Math.round((subtotalPaise * gstPercent) / 100);
    const totalPaise = subtotalPaise + gstPaise;

    return {
        kind, periodStart, periodEnd, totalDays, remainingDays,
        currentPaidPaise: current.paidSubtotalPaise,
        newPlanChargePaise, creditAppliedPaise, unusedCreditPaise,
        subtotalPaise, gstPercent, gstPaise, totalPaise,
        zeroPayable: totalPaise === 0,
    };
}
