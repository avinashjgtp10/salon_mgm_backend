import crypto from "crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../../middleware/error.middleware";

// Consent to be billed in INR when the customer's own currency cannot be charged.
//
// A boolean sent by the browser proves nothing, so consent is a short-lived, SIGNED token that only the server can issue. It is
// handed out inside the CURRENCY_NOT_ENABLED response together with the exact INR amount, and is bound to the signed-in user, the plan,
// the cycle, the country, the currency that was asked for and the exact INR total. Checkout accepts INR billing only with a token that
// verifies against the amount the server calculates again at that moment: if the price, plan, country or user differs, or the token is
// expired or forged, the request is refused and a fresh offer is returned. The customer's confirmation click is what makes the browser
// send the token; the server records the consent (time, requested currency, amount) with the subscription.

export interface ConsentBinding {
    userId: string;
    tier: string;
    cycle: string;
    country: string;
    /** The currency the customer would have been billed in (their country's currency). */
    requestedCurrency: string;
    /** The INR total they are being asked to accept. */
    amount: number;
}

const TTL_SECONDS = 15 * 60;

function secret(): string {
    const s = process.env.CURRENCY_CONSENT_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!s) throw new AppError(500, "Server is not configured to issue billing consent", "SERVER_ERROR");
    return s;
}

export function issueConsentToken(b: ConsentBinding): string {
    return jwt.sign(
        { purpose: "currency_fallback", uid: b.userId, tier: b.tier, cycle: b.cycle, country: b.country, req: b.requestedCurrency, cur: "INR", amt: b.amount },
        secret(),
        { algorithm: "HS256", expiresIn: TTL_SECONDS, jwtid: crypto.randomUUID() },
    );
}

export type ConsentCheck = { ok: true } | { ok: false; reason: "missing" | "invalid" | "expired" | "mismatch" };

/** Verifies the token against what the server has just calculated. Never throws for a bad token; callers decide what to answer. */
export function checkConsentToken(token: unknown, expected: ConsentBinding): ConsentCheck {
    if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
    let c: any;
    try {
        c = jwt.verify(token, secret(), { algorithms: ["HS256"] });
    } catch (err: any) {
        return { ok: false, reason: err?.name === "TokenExpiredError" ? "expired" : "invalid" };
    }
    const same =
        c.purpose === "currency_fallback" && c.cur === "INR" &&
        c.uid === expected.userId && c.tier === expected.tier && c.cycle === expected.cycle &&
        c.country === expected.country && c.req === expected.requestedCurrency &&
        Math.round(Number(c.amt) * 100) === Math.round(expected.amount * 100);
    return same ? { ok: true } : { ok: false, reason: "mismatch" };
}

// ── Confirmation of a scheduled plan change (same idea: signed, bound to exactly what the customer was shown) ───────────────────────

export interface PlanChangeBinding {
    userId: string;
    /** The subscription being replaced. */
    currentSubscriptionId: string;
    tier: string;
    cycle: string;
    currency: string;
    /** The amount charged each cycle for the new plan, in `currency`. */
    amount: number;
    /** When the new plan starts (the end of the current period), ISO string. */
    startsAt: string;
}

export function issuePlanChangeToken(b: PlanChangeBinding): string {
    return jwt.sign(
        { purpose: "plan_change", uid: b.userId, sub: b.currentSubscriptionId, tier: b.tier, cycle: b.cycle, cur: b.currency, amt: b.amount, at: b.startsAt },
        secret(),
        { algorithm: "HS256", expiresIn: TTL_SECONDS, jwtid: crypto.randomUUID() },
    );
}

export function checkPlanChangeToken(token: unknown, expected: PlanChangeBinding): ConsentCheck {
    if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
    let c: any;
    try {
        c = jwt.verify(token, secret(), { algorithms: ["HS256"] });
    } catch (err: any) {
        return { ok: false, reason: err?.name === "TokenExpiredError" ? "expired" : "invalid" };
    }
    const same =
        c.purpose === "plan_change" && c.uid === expected.userId && c.sub === expected.currentSubscriptionId &&
        c.tier === expected.tier && c.cycle === expected.cycle && c.cur === expected.currency &&
        Math.round(Number(c.amt) * 100) === Math.round(expected.amount * 100) &&
        new Date(c.at).getTime() === new Date(expected.startsAt).getTime();
    return same ? { ok: true } : { ok: false, reason: "mismatch" };
}
