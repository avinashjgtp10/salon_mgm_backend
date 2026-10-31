import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpay } from "../../config/razorpay";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";
import { subscriptionPricingService, CYCLES, TIERS } from "../subscription-pricing/pricing.service";
import { resolveRazorpayPlan } from "../subscription-pricing/razorpay-plans";
import { checkPlanChangeToken, issuePlanChangeToken, type PlanChangeBinding } from "../subscription-pricing/currency-consent";
import { dbDate, normalizeCycle, tierOfPlan } from "../subscription-billing/plan-tier";
import { changeKindOf } from "../subscription-upgrade/upgrade-quote";

// Changing a plan so that it takes effect WHEN THE CURRENT PERIOD ENDS: a lower plan (downgrade) or the same plan on a shorter billing
// cycle, for a subscription billed in INR or in any other currency.
//
// The in-place upgrade flow (subscription-upgrade) is for moving UP and charges a prorated difference now. It also must not touch a
// subscription billed in another currency (credit, tax and payment would mix currencies); it refuses with CURRENCY_UPGRADE_UNSUPPORTED.
// This is the alternative for both cases: a NEW Razorpay subscription for the new plan that STARTS WHEN THE CURRENT PERIOD ENDS (Razorpay
// `start_at`), authorised by the customer on Razorpay's hosted page. Everything already paid for is used first, nothing is charged today,
// and the new plan's features apply from the day it starts.
//
//   - The current subscription is left completely untouched until the customer has authorised the new one.
//   - Once the new subscription is authenticated, the old one is set to cancel at the end of its cycle (never immediately), so it simply
//     stops renewing; the new one takes over on the same date. The customer is never charged twice for the same period.
//   - If the customer never authorises the new subscription, nothing changes: the current plan renews as before.
//   - Only one pending replacement per subscription; asking again for the same plan returns the same payment link.
//   - The customer must confirm first: the first call returns 409 PLAN_CHANGE_CONFIRMATION_REQUIRED describing exactly what will happen,
//     with a signed token bound to that offer; only a request carrying a valid token creates anything.
//   - The new plan is priced in the SAME currency and country as the current subscription, by the server. If that currency can no
//     longer be charged it stops with CURRENCY_NOT_ENABLED; it never switches the customer's currency on its own.

const TOTAL_COUNT = { monthly: 120, quarterly: 40, yearly: 10 } as const;
const MIN_LEAD_MS = 60 * 60 * 1000;   // the new subscription must start at least an hour from now

const isTier = (v: unknown): v is (typeof TIERS)[number] => (TIERS as readonly string[]).includes(v as string);
const isCycle = (v: unknown): v is (typeof CYCLES)[number] => (CYCLES as readonly string[]).includes(v as string);
const money = (n: number, cur: string) => new Intl.NumberFormat("en", { style: "currency", currency: cur }).format(n);

export const subscriptionPlanChangeService = {
    async schedule(salonId: string | null, userId: string, tier: unknown, cycle: unknown, confirmationToken?: unknown) {
        if (!salonId) throw new AppError(403, "A salon is required to change a plan", "FORBIDDEN");
        if (!isTier(tier) || !isCycle(cycle)) {
            throw new AppError(400, "tier must be basic, advance or growth and cycle monthly, quarterly or yearly", "VALIDATION_ERROR");
        }
        if (!(await billingSchemaReady())) {
            throw new AppError(503, "Plan changes are not available on this server yet (database migration missing).", "BILLING_SCHEMA_MISSING");
        }

        const { rows } = await pool.query(
            `SELECT s.id, s.plan_id, s.razorpay_subscription_id, s.current_period_end, s.charged_currency, s.charged_amount, s.country_code,
                    sp.slug, sp.name AS plan_name, sp.tier AS plan_tier, sp.billing_cycle AS plan_cycle
             FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
             WHERE s.salon_id = $1 AND s.status = 'active' AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
             ORDER BY s.created_at DESC LIMIT 1`,
            [salonId]
        );
        const current = rows[0];
        if (!current) throw new AppError(409, "This salon has no active subscription to change.", "NO_SUBSCRIPTION");
        // A subscription with no recorded currency is an INR one (the original behaviour).
        const currency: string = current.charged_currency ?? "INR";
        // Without a Razorpay subscription (a plan assigned by SalonOx) there is nothing to stop later: it simply ends on its date and the new
        // one starts then. A fixed end date is all that is needed.
        if (!current.current_period_end) {
            throw new AppError(409, "This subscription has no fixed billing period, so the change can't be scheduled online. Please contact support.", "NOT_SCHEDULABLE");
        }
        const periodEnd = dbDate(current.current_period_end) ?? new Date(current.current_period_end);
        if (periodEnd.getTime() - Date.now() < MIN_LEAD_MS) {
            throw new AppError(409, "Your current period ends very soon. Wait for the renewal, then change your plan.", "PLAN_CHANGE_TOO_LATE");
        }

        // Priced by the server, in the subscription's own currency and country. An INR subscription is priced from the Indian list (price + GST),
        // exactly what its renewals charge, whatever country the customer picked.
        const { base, quote } = await subscriptionPricingService.quote(tier, cycle, currency === "INR" ? "IN" : current.country_code);
        if (base.id === current.plan_id) throw new AppError(409, "That is already your current plan.", "SAME_PLAN");
        const currentTier = tierOfPlan({ tier: current.plan_tier, name: current.plan_name, slug: current.slug });
        const currentCycle = normalizeCycle(current.plan_cycle) ?? normalizeCycle(/-(monthly|quarterly|yearly)$/.exec(String(current.slug ?? ""))?.[1]);
        const kind = currentCycle ? changeKindOf({ tier: currentTier, cycle: currentCycle }, { tier, cycle }) : "upgrade";
        if (quote.charge.currency !== currency || (quote.charge.fallback && currency !== "INR")) {
            throw new AppError(
                409,
                `Subscriptions in ${currency} are not available right now, so this plan change can't be scheduled. Contact support.`,
                "CURRENCY_NOT_ENABLED",
                { current_currency: currency, alternatives: [{ type: "contact_support", label: "Contact support" }] },
            );
        }

        const binding: PlanChangeBinding = {
            userId, currentSubscriptionId: current.id, tier, cycle, currency, amount: quote.charge.total, startsAt: periodEnd.toISOString(),
        };

        // Only one replacement can be pending.
        const pending = (await pool.query(
            `SELECT razorpay_subscription_id, plan_id FROM subscriptions
             WHERE replaces_subscription_id = $1 AND status IN ('created', 'authenticated') ORDER BY created_at DESC LIMIT 1`,
            [current.id]
        )).rows[0];
        if (pending && pending.plan_id !== base.id) {
            throw new AppError(409, "Another plan change is already waiting for your authorisation. Complete it, or contact support to cancel it.", "PLAN_CHANGE_PENDING");
        }

        const check = checkPlanChangeToken(confirmationToken, binding);
        if (!check.ok) {
            const when = periodEnd.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
            throw new AppError(
                409,
                `${base.name} will start on ${when}, when your current plan ends, at ${money(quote.charge.total, currency)}${quote.charge.tax > 0 ? ` (incl. ${quote.charge.tax_percent}% GST)` : ""} per ${cycle === "yearly" ? "year" : cycle === "quarterly" ? "quarter" : "month"}. Your current plan stays active until then and you are not charged twice.`,
                "PLAN_CHANGE_CONFIRMATION_REQUIRED",
                {
                    consent_status: check.reason,
                    kind,
                    current: { plan_name: current.plan_name, tier: currentTier, cycle: currentCycle, currency, amount: current.charged_amount == null ? null : Number(current.charged_amount), ends_at: periodEnd.toISOString() },
                    next: {
                        plan_name: base.name, tier, cycle, currency, amount: quote.charge.total, starts_at: periodEnd.toISOString(),
                        subtotal: quote.charge.subtotal, tax: quote.charge.tax, tax_percent: quote.charge.tax_percent,
                    },
                    confirmation_token: issuePlanChangeToken(binding),
                },
            );
        }

        if (pending) {
            const existing: any = await (await getRazorpay()).subscriptions.fetch(pending.razorpay_subscription_id);
            return { short_url: existing.short_url as string, razorpay_subscription_id: pending.razorpay_subscription_id as string, starts_at: periodEnd.toISOString(), already_pending: true };
        }

        const razorpayPlanId = await resolveRazorpayPlan(base, currency, quote.charge.subtotal, quote.charge.fx_rate);
        let created: any;
        try {
            created = await (await getRazorpay()).subscriptions.create({
                plan_id: razorpayPlanId,
                total_count: TOTAL_COUNT[cycle],
                quantity: 1,
                customer_notify: 1,
                start_at: Math.floor(periodEnd.getTime() / 1000),
                notes: {
                    salon_id: salonId, user_id: userId, plan_slug: base.slug, country: quote.country, charge_currency: currency,
                    ...(current.razorpay_subscription_id ? { replaces: current.razorpay_subscription_id } : {}),
                },
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            const detail = err?.error?.description ?? err?.message ?? "unknown error";
            logger.error("Razorpay plan-change subscription create failed", { salonId, slug: base.slug, currency, detail });
            throw new AppError(502, `Razorpay could not schedule the plan change: ${detail}`, "RAZORPAY_ERROR");
        }

        await pool.query(
            `INSERT INTO subscriptions
                (salon_id, user_id, plan_id, status, is_trial, cancel_at_period_end, razorpay_subscription_id, replaces_subscription_id,
                 country_code, pricing_currency, charged_currency, charged_amount, charged_tax, base_price_inr, display_amount, fx_rate, pricing_razorpay_plan_id)
             VALUES ($1, $2, $3, 'created', FALSE, FALSE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [salonId, userId, base.id, created.id, current.id, quote.country, quote.display.currency, currency, quote.charge.total, quote.charge.tax,
             base.price, quote.display.total, quote.charge.fx_rate, razorpayPlanId]
        );
        logger.info("Plan change scheduled", { salonId, from: current.slug, to: base.slug, startsAt: periodEnd.toISOString() });
        return { short_url: created.short_url as string, razorpay_subscription_id: created.id as string, starts_at: periodEnd.toISOString(), already_pending: false };
    },

    // Called after a webhook commit when a subscription became 'authenticated': if it replaces another one, that one is set to cancel at
    // the end of its cycle (never now). Safe to repeat.
    async onAuthenticated(razorpaySubscriptionId: string | undefined): Promise<void> {
        if (!razorpaySubscriptionId || !(await billingSchemaReady())) return;
        const { rows } = await pool.query(
            `SELECT old.id AS old_id, old.razorpay_subscription_id AS old_rzp
             FROM subscriptions nw JOIN subscriptions old ON old.id = nw.replaces_subscription_id
             WHERE nw.razorpay_subscription_id = $1 AND old.status IN ('active', 'trialing')`,
            [razorpaySubscriptionId]
        );
        const r = rows[0];
        if (!r?.old_rzp) return;
        try {
            await ((await getRazorpay()).subscriptions as any).cancel(r.old_rzp, true);   // true = at the end of the current cycle
        } catch (err: any) {
            const detail = String(err?.error?.description ?? err?.message ?? "");
            // "Already cancelled" or "no billing cycle is going on" means it will not renew anyway: nothing more to do. Anything else
            // (rate limit, network, an unexpected refusal) is NOT treated as done: the old subscription is left unmarked and the error
            // is raised so the webhook fails and Razorpay delivers it again. Handling the event again is safe (idempotent).
            if (!/already.*cancel|no billing cycle|has been cancelled/i.test(detail)) {
                logger.error("Could not schedule the replaced subscription to end at cycle end", { old: r.old_rzp, error: detail });
                throw new AppError(502, `Razorpay could not schedule the old subscription to end: ${detail}`, "RAZORPAY_ERROR");
            }
            logger.warn("Replaced subscription needs no further cancellation", { old: r.old_rzp, detail });
        }
        await pool.query(`UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1`, [r.old_id]);
    },
};
