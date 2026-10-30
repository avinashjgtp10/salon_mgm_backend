import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { createRazorpayPlan, getRazorpay, razorpayBilling } from "../../config/razorpay";
import { billingSchemaReady } from "./billing-schema";
import { getActiveRazorpayAccount } from "./razorpay-account";
import type { BasePlan } from "./pricing.service";

// Finds or creates the Razorpay plan a checkout needs, so the subscription is created against a plan that exists on the Razorpay
// ACCOUNT THE SERVER IS USING NOW and that charges exactly the amount and currency that were quoted.
//
// Plan IDs live in razorpay_plan_registry, keyed by the account's fingerprint (razorpay-account.ts), so TEST and LIVE (or any two
// accounts) can never read or overwrite each other's IDs. subscription_plans.razorpay_plan_id (the original single column) is
// never written here; for INR it is only a candidate that is adopted into the registry when the active account recognises it
// with the same amount and currency (a read-only check). Existing subscriptions keep working untouched: they are tied to their own
// Razorpay subscription ID, and renewals are driven by Razorpay's schedule.

const CYCLE_LABEL = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" } as const;

const isNotFound = (err: any) =>
    err?.statusCode === 400 && /not be found|not found|invalid/i.test(String(err?.error?.description ?? err?.message ?? ""));

export interface FetchedPlan { id: string; currency: string; amountMinor: number; period: string; interval: number }

/** The plan on the active account, or null when Razorpay does not know the ID. Rate limits and network failures are errors, never "not found". */
export async function fetchPlanOrNull(razorpayPlanId: string): Promise<FetchedPlan | null> {
    try {
        const p: any = await (await getRazorpay()).plans.fetch(razorpayPlanId);
        return { id: p.id, currency: String(p.item?.currency ?? ""), amountMinor: Number(p.item?.amount), period: String(p.period), interval: Number(p.interval) };
    } catch (err: any) {
        if (isNotFound(err)) return null;
        if (err instanceof AppError) throw err;
        if (err?.statusCode === 429) {
            throw new AppError(503, "Razorpay is busy right now (rate limit). Please try again in a moment.", "RAZORPAY_RATE_LIMITED");
        }
        const detail = err?.error?.description ?? err?.message ?? "unknown error";
        throw new AppError(502, `Razorpay could not be reached to check the plan: ${detail}`, "RAZORPAY_UNREACHABLE");
    }
}

const toMinor = (amount: number) => Math.round(amount * 100);

/** Records a Razorpay plan ID for the ACTIVE account only (never touches another account's rows). */
export async function registerPlanId(
    planId: string, cycle: BasePlan["cycle"], currency: string, amount: number, basePriceInr: number, fxRate: number, razorpayPlanId: string,
) {
    if (!(await billingSchemaReady())) return;
    const account = await getActiveRazorpayAccount();
    const billing = razorpayBilling(cycle);
    await pool.query(
        `INSERT INTO razorpay_plan_registry
            (plan_id, account_key, mode, currency, amount, base_price_inr, fx_rate, razorpay_plan_id, period, interval_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (plan_id, account_key, currency, amount) DO UPDATE SET razorpay_plan_id = EXCLUDED.razorpay_plan_id`,
        [planId, account.key, account.mode, currency, amount, basePriceInr, fxRate, razorpayPlanId, billing.period, billing.interval]
    );
}

const register = (base: BasePlan, currency: string, amount: number, fxRate: number, razorpayPlanId: string) =>
    registerPlanId(base.id, base.cycle, currency, amount, base.price, fxRate, razorpayPlanId);

/**
 * The Razorpay plan for (plan, currency, amount) on the active account.
 *  1. the registry row for this account, if Razorpay still knows its ID;
 *  2. INR only: the original subscription_plans.razorpay_plan_id, adopted into the registry when this account recognises it with
 *     the same amount, currency and billing period (nothing is written to subscription_plans);
 *  3. otherwise a new plan is created on this account and registered.
 * A non-INR plan that Razorpay refuses stops the checkout with CURRENCY_NOT_SUPPORTED; nothing is charged.
 */
export async function resolveRazorpayPlan(base: BasePlan, currency: string, amount: number, fxRate: number): Promise<string> {
    if (!(await billingSchemaReady())) {
        // The registry migration has not been applied yet: INR keeps working exactly as before through the original column (nothing is
        // written); a non-INR plan needs the registry and is refused.
        if (currency === "INR" && base.razorpay_plan_id) return base.razorpay_plan_id;
        throw new AppError(503, "Plan registry is not available on this server yet (database migration missing).", "BILLING_SCHEMA_MISSING");
    }
    const account = await getActiveRazorpayAccount();
    const billing = razorpayBilling(base.cycle);

    const existing = await pool.query(
        `SELECT razorpay_plan_id FROM razorpay_plan_registry WHERE plan_id = $1 AND account_key = $2 AND currency = $3 AND amount = $4`,
        [base.id, account.key, currency, amount]
    );
    const row = existing.rows[0];
    if (row?.razorpay_plan_id && (await fetchPlanOrNull(row.razorpay_plan_id))) return row.razorpay_plan_id;

    if (currency === "INR" && base.razorpay_plan_id) {
        const candidate = await fetchPlanOrNull(base.razorpay_plan_id);
        if (candidate && candidate.currency === "INR" && candidate.amountMinor === toMinor(amount)
            && candidate.period === billing.period && candidate.interval === billing.interval) {
            await register(base, currency, amount, fxRate, candidate.id);
            return candidate.id;
        }
    }

    let created: string;
    try {
        created = await createRazorpayPlan({
            name: `${base.name} (${CYCLE_LABEL[base.cycle]}${currency === "INR" ? "" : `, ${currency}`})`,
            description: currency === "INR" ? `${base.name}. Includes GST.` : `${base.name} billed in ${currency}.`,
            ...billing,
            amountRupees: amount,
            currency,
        });
    } catch (err: any) {
        if (currency === "INR") throw err;
        logger.error("Razorpay refused a non-INR subscription plan", { slug: base.slug, currency, amount, account: account.mode, error: err?.message });
        throw new AppError(
            409,
            `Subscriptions in ${currency} are not available on our payment account right now. Choose another country, continue in INR, or contact support. (${err?.message ?? "Razorpay error"})`,
            "CURRENCY_NOT_SUPPORTED"
        );
    }
    await register(base, currency, amount, fxRate, created);
    logger.info("Razorpay plan created and registered", { slug: base.slug, currency, account: account.mode, razorpayPlanId: created });
    return created;
}
