import crypto from "crypto";
import type { PoolClient } from "pg";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpay, getRazorpayCredentials } from "../../config/razorpay";
import { GST_PERCENT } from "../plan-pricing/plan-pricing.service";
import { subscriptionInvoicesRepository as invoiceRepo } from "../subscription-invoices/subscription-invoices.repository";
import { subscriptionInvoicesService } from "../subscription-invoices/subscription-invoices.service";
import { salonModulesService } from "../salon-modules/salon-modules.service";
import {
    dbDate, isCycle, isTier, normalizeCycle, tierOfPlan, type Cycle, type Tier,
} from "../subscription-billing/plan-tier";
import { deriveSubscriptionState, isLiveState } from "../subscription-billing/subscription-status";
import {
    loadPaidInfo, loadSalonSubscriptions, pickCurrentSubscription, subscriptionEnd, type SubRow,
} from "../subscription-billing/subscription-billing.service";
import { calculateUpgradeQuote, convertUpgradeQuote, fromPaise, toPaise, UpgradeError, type UpgradeQuote } from "./upgrade-quote";
import { loadUpgradePolicy } from "./upgrade-policy";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";
import { markCurrencyRefused, subscriptionPricingService } from "../subscription-pricing/pricing.service";
import { currencyForCountry } from "../subscription-pricing/country-currency";

// Plan upgrade flow (Advance -> Growth etc). The salon never sends an amount: the backend prices the upgrade
// (upgrade-quote.ts / upgrade-policy.ts), stores that quote with the pending upgrade, creates the Razorpay order for exactly
// that amount, and only activates the new plan after the payment has been VERIFIED with Razorpay (signature + the payment's own
// record), or straight away when the credit covers everything. Completion is idempotent: the upgrade row is locked and can
// leave 'pending' only once, so a repeated callback, a double click, or the webhook racing the browser cannot activate it twice.

type Db = Pick<PoolClient, "query">;

async function inTransaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

const upgradeAppError = (e: UpgradeError) =>
    new AppError(409, e.message, e.code === "EXPIRED" ? "SUBSCRIPTION_EXPIRED" : e.code === "INVALID" ? "PLAN_UNAVAILABLE" : "UPGRADE_NOT_ALLOWED");

// ── quote ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface BuiltQuote {
    quote: UpgradeQuote;
    current: SubRow;
    currentTier: Tier | null;
    currentCycle: Cycle;
    target: { id: string; name: string; tier: Tier; cycle: Cycle; price: number };
    /** What the upgrade is charged in (INR unless the customer's own currency is chargeable); every amount in `quote` is in this currency. */
    currency: string;
    /** Units of `currency` per 1 INR (1 for INR). */
    fxRate: number;
    country: string | null;
}

// The columns the upgrade needs for a non-INR charge (subscription_upgrades.currency / fx_rate / country_code), added by
// Migration/add_currency_to_subscription_upgrades.sql. Only a positive answer is remembered, so running the migration needs no restart.
let upgradeCurrencyColumns = false;
async function upgradeCurrencyReady(): Promise<boolean> {
    if (upgradeCurrencyColumns) return true;
    if (!(await billingSchemaReady())) return false;
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'subscription_upgrades' AND column_name IN ('currency', 'fx_rate', 'country_code')`
    );
    upgradeCurrencyColumns = rows[0]?.n === 3;
    return upgradeCurrencyColumns;
}

// The customer's country for pricing: the one the page sent (their pick), else their account's, else their salon's, else India.
async function resolveUpgradeCountry(db: Db, userId: string | null, salonId: string, provided: unknown): Promise<string> {
    const direct = currencyForCountry(typeof provided === "string" ? provided : null);
    if (direct) return direct.country;
    const { rows } = await db.query(
        `SELECT s.country AS salon_country, ${userId ? "(SELECT country FROM users WHERE id = $2)" : "NULL"} AS user_country FROM salons s WHERE s.id = $1`,
        userId ? [salonId, userId] : [salonId]
    );
    return currencyForCountry(rows[0]?.user_country)?.country ?? currencyForCountry(rows[0]?.salon_country)?.country ?? "IN";
}

// The upgrade flow prices a prorated difference in INR and settles it with a one-off INR payment. A subscription billed in another
// currency would mix currencies (credit, tax, payment), so it is refused here; the plan change for those is scheduled for the end of
// the current period instead (subscription-plan-change.service.ts).
export async function assertInrSubscription(db: Db, subscriptionId: string, periodEnd: Date | string | null | undefined) {
    if (!(await billingSchemaReady())) return;
    const { rows } = await db.query(`SELECT charged_currency FROM subscriptions WHERE id = $1`, [subscriptionId]);
    const currency: string | null = rows[0]?.charged_currency ?? null;
    if (currency && currency !== "INR") {
        throw new AppError(
            409,
            `Your plan is billed in ${currency}, so it can't be upgraded in place. You can schedule the change to start when your current period ends; your current plan stays active until then.`,
            "CURRENCY_UPGRADE_UNSUPPORTED",
            { current_currency: currency, current_period_end: periodEnd ?? null, alternatives: [{ type: "schedule_plan_change" }, { type: "contact_support" }] },
        );
    }
}

export async function buildQuote(db: Db, salonId: string, tier: Tier, cycle: Cycle, now: Date = new Date(), country: string | null = null): Promise<BuiltQuote> {
    const rows = await loadSalonSubscriptions(db as never, salonId);
    const { rows: salonRows } = await db.query(`SELECT is_active FROM salons WHERE id = $1`, [salonId]);
    const current = pickCurrentSubscription(rows, now);
    if (!current) throw new AppError(409, "This salon has no subscription to upgrade. Choose a plan instead.", "NO_SUBSCRIPTION");

    const end = subscriptionEnd(current);
    const state = deriveSubscriptionState({ status: current.status, periodEnd: end, now, salonActive: salonRows[0]?.is_active !== false });
    if (!isLiveState(state)) {
        throw new AppError(409, state === "pending_payment"
            ? "Your current plan payment is still pending."
            : "Your subscription is not active. Renew it to continue.", "SUBSCRIPTION_NOT_ACTIVE");
    }

    await assertInrSubscription(db, current.id, end);

    const currentCycle = normalizeCycle(current.plan_cycle);
    if (!currentCycle || !end) {
        throw new AppError(409, "Your current plan has no fixed billing period, so it can't be upgraded online. Please contact support.", "NOT_PRORATABLE");
    }
    const start = current.current_period_start ?? current.created_at;

    const { rows: planRows } = await db.query(
        `SELECT id, name, price FROM subscription_plans WHERE slug = $1 AND is_active = TRUE`,
        [`salonox-${tier}-${cycle}`]
    );
    if (!planRows[0]) throw new AppError(404, "That plan isn't available at that billing cycle.", "PLAN_UNAVAILABLE");

    const paid = await loadPaidInfo(db as never, salonId, current);
    const policy = loadUpgradePolicy();
    const currentTier = tierOfPlan({ tier: current.plan_tier, name: current.plan_name, slug: current.plan_slug });

    // Overseas customer whose own currency can be charged right now: price the upgrade in INR without Indian GST, then convert it with the
    // same rate the pricing page and the subscription checkout use. Anything else stays exactly as before (INR + GST).
    let currency = "INR";
    let fxRate = 1;
    if (country && currencyForCountry(country)?.currency !== "INR" && (await upgradeCurrencyReady())) {
        const { quote: priced } = await subscriptionPricingService.quote(tier, cycle, country);
        if (!priced.charge.fallback && priced.charge.currency !== "INR") { currency = priced.charge.currency; fxRate = priced.charge.fx_rate; }
    }

    let quote: UpgradeQuote;
    try {
        quote = calculateUpgradeQuote({
            now, gstPercent: currency === "INR" ? GST_PERCENT : 0, policy,
            current: {
                tier: currentTier, cycle: currentCycle, periodStart: new Date(start), periodEnd: new Date(end),
                paidSubtotalPaise: paid.state === "paid" && paid.subtotal != null ? toPaise(paid.subtotal) : 0,
            },
            target: { tier, cycle, pricePaise: toPaise(Number(planRows[0].price)) },
        });
    } catch (e) {
        if (e instanceof UpgradeError) throw upgradeAppError(e);
        throw e;
    }
    if (currency !== "INR") quote = convertUpgradeQuote(quote, fxRate);
    return {
        quote, current, currentTier, currentCycle, currency, fxRate, country,
        target: { id: planRows[0].id, name: planRows[0].name, tier, cycle, price: Number(planRows[0].price) },
    };
}

function quoteView(b: BuiltQuote) {
    const q = b.quote;
    return {
        kind: q.kind,
        /** Every amount below is in this currency (INR unless the customer's own currency is being charged). */
        currency: b.currency,
        approximate_conversion: b.currency !== "INR",
        current: {
            plan_name: b.current.plan_name, tier: b.currentTier, cycle: b.currentCycle,
            period_start: b.current.current_period_start, period_end: subscriptionEnd(b.current),
            paid_subtotal: fromPaise(q.currentPaidPaise),
        },
        target: { plan_name: b.target.name, tier: b.target.tier, cycle: b.target.cycle, price: Math.round(b.target.price * b.fxRate * 100) / 100 },
        total_days: q.totalDays,
        remaining_days: q.remainingDays,
        new_plan_charge: fromPaise(q.newPlanChargePaise),
        credit_applied: fromPaise(q.creditAppliedPaise),
        unused_credit_not_refunded: fromPaise(q.unusedCreditPaise),
        subtotal: fromPaise(q.subtotalPaise),
        gst_percent: q.gstPercent,
        gst_amount: fromPaise(q.gstPaise),
        total: fromPaise(q.totalPaise),
        zero_payable: q.zeroPayable,
        new_period_start: q.periodStart.toISOString(),
        new_period_end: q.periodEnd.toISOString(),
        keeps_current_end_date: q.kind === "upgrade",
    };
}

function parseTarget(tier: unknown, cycle: unknown) {
    if (!isTier(tier) || !isCycle(cycle)) throw new AppError(400, "tier must be basic, advance or growth and cycle monthly, quarterly or yearly", "VALIDATION_ERROR");
    return { tier, cycle };
}

// ── completion (the only place a plan is changed) ───────────────────────────────────────────────────────────────────

interface Completion {
    outcome: "completed" | "already_completed" | "needs_review" | "not_pending";
    upgradeId: string;
    salonId: string;
    tier: Tier | null;
    newSubscriptionId: string | null;
    invoiceId: string | null;
    invoiceCreated: boolean;
    razorpaySubscriptionToCancel: string | null;
    reason?: string;
}

const money = (n: number, currency = "INR") =>
    `${currency === "INR" ? "Rs." : currency} ${n.toLocaleString(currency === "INR" ? "en-IN" : "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function completeUpgrade(db: PoolClient, upgradeId: string, pay: { paymentId: string | null; method: string | null; paidAt: Date }): Promise<Completion> {
    // The lock on this row is what makes everything below happen at most once.
    const { rows } = await db.query(`SELECT * FROM subscription_upgrades WHERE id = $1 FOR UPDATE`, [upgradeId]);
    const u = rows[0];
    if (!u) throw new AppError(404, "Upgrade not found", "NOT_FOUND");

    const base: Completion = {
        outcome: "completed", upgradeId, salonId: u.salon_id, tier: isTier(u.to_tier) ? u.to_tier : null,
        newSubscriptionId: u.new_subscription_id, invoiceId: null, invoiceCreated: false, razorpaySubscriptionToCancel: null,
    };
    if (u.status === "completed") return { ...base, outcome: "already_completed" };

    // Money arrived for an attempt that was already cancelled / failed, or the salon's plan changed meanwhile: do not guess.
    // Park it for a person to review (and refund if needed), keeping the payment reference.
    const park = async (reason: string): Promise<Completion> => {
        await db.query(
            `UPDATE subscription_upgrades SET status = 'needs_review', razorpay_payment_id = COALESCE($2, razorpay_payment_id), failure_reason = $3 WHERE id = $1`,
            [upgradeId, pay.paymentId, reason]
        );
        logger.error("Upgrade payment needs review", { upgradeId, paymentId: pay.paymentId, reason });
        return { ...base, outcome: "needs_review", reason };
    };
    if (u.status !== "pending") {
        if (pay.paymentId) return park(`Payment received while the upgrade was ${u.status}`);
        return { ...base, outcome: "not_pending", reason: `Upgrade is ${u.status}` };
    }

    const { rows: fromRows } = await db.query(`SELECT * FROM subscriptions WHERE id = $1 AND salon_id = $2 FOR UPDATE`, [u.from_subscription_id, u.salon_id]);
    const from = fromRows[0];
    const fromEnd = from ? dbDate(from.status === "trialing" ? from.trial_end ?? from.current_period_end : from.current_period_end ?? from.trial_end) : null;
    const stillLive = from && (from.status === "active" || from.status === "trialing") && fromEnd && fromEnd.getTime() > Date.now();
    if (!stillLive) return pay.paymentId ? park("The subscription being upgraded is no longer active") : { ...base, outcome: "not_pending", reason: "The subscription being upgraded is no longer active" };

    const { rows: planRows } = await db.query(`SELECT id, name FROM subscription_plans WHERE id = $1`, [u.to_plan_id]);
    const { rows: fromPlanRows } = await db.query(`SELECT name FROM subscription_plans WHERE id = $1`, [from.plan_id]);

    // The new subscription row. History is kept: the old one is marked 'upgraded', never deleted or overwritten.
    const { rows: ns } = await db.query(
        `INSERT INTO subscriptions (salon_id, plan_id, status, is_trial, cancel_at_period_end, current_period_start, current_period_end)
         VALUES ($1, $2, 'active', FALSE, FALSE, $3, $4) RETURNING id`,
        [u.salon_id, u.to_plan_id, u.period_start, u.period_end]
    );
    const newSubscriptionId = ns[0].id as string;
    await db.query(
        `UPDATE subscriptions SET status = 'upgraded', cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1`,
        [from.id]
    );

    // What the attempt was priced and paid in. INR unless the customer's own currency was charged (then every stored amount is in it).
    const currency: string = u.currency ?? "INR";
    const overseas = currency !== "INR";
    if (overseas) {
        // Record the new subscription as billed in that currency, so a later upgrade is not priced as if it were INR.
        await db.query(
            `UPDATE subscriptions SET country_code = $2, pricing_currency = $3, charged_currency = $3, charged_amount = $4, charged_tax = 0, fx_rate = $5 WHERE id = $1`,
            [newSubscriptionId, u.country_code ?? null, currency, Number(u.total), u.fx_rate ?? null]
        );
    }

    const total = Number(u.total);
    let paymentRowId: string | null = null;
    if (total > 0 && pay.paymentId) {
        const ins = await db.query(
            `INSERT INTO subscription_payments
                (subscription_id, amount, payment_status, payment_method, transaction_id, billing_period_start, billing_period_end, paid_at${overseas ? ", currency" : ""})
             VALUES ($1, $2, 'paid', $3, $4, $5, $6, $7${overseas ? ", $8" : ""}) RETURNING id`,
            [newSubscriptionId, total, pay.method, pay.paymentId, u.period_start, u.period_end, pay.paidAt, ...(overseas ? [currency] : [])]
        );
        paymentRowId = ins.rows[0].id;
    }

    const credit = Number(u.credit_applied);
    const description =
        `Upgrade from ${fromPlanRows[0]?.name ?? "previous plan"} to ${planRows[0].name}` +
        (u.kind === "upgrade"
            ? `, prorated for the remaining ${u.remaining_days} of ${u.total_days} days (current period end date unchanged)`
            : ", new billing term starting today") +
        (credit > 0 ? `. Credit of ${money(credit, currency)} for the unused value of the previous plan applied.` : ".");
    const invoice = await invoiceRepo.createForUpgrade(db, {
        upgradeId, salonId: u.salon_id, subscriptionId: newSubscriptionId, paymentId: paymentRowId,
        planName: planRows[0].name, billingCycle: u.to_cycle,
        periodStart: String(u.period_start).slice(0, 10), periodEnd: String(u.period_end).slice(0, 10),
        subtotal: Number(u.subtotal), gstPercent: Number(u.gst_percent), gstAmount: Number(u.gst_amount), total,
        credit, description, paymentMode: pay.method ? pay.method.toUpperCase() : (total > 0 ? "RAZORPAY" : "CREDIT"),
        transactionId: pay.paymentId, issuedAt: pay.paidAt, createdBy: u.created_by, currency,
    });

    await db.query(
        `UPDATE subscription_upgrades
         SET status = 'completed', razorpay_payment_id = COALESCE($2, razorpay_payment_id), new_subscription_id = $3,
             failure_reason = NULL, completed_at = NOW()
         WHERE id = $1`,
        [upgradeId, pay.paymentId, newSubscriptionId]
    );

    return {
        ...base, outcome: "completed", newSubscriptionId, invoiceId: invoice.id, invoiceCreated: invoice.created,
        razorpaySubscriptionToCancel: from.razorpay_subscription_id ?? null,
    };
}

// What happens once the money (or the zero-payable decision) is committed. Each step is best-effort and logged: the plan
// change itself is already safely recorded, and every step is safe to run again.
async function afterCompletion(c: Completion, actingUserId: string | null) {
    if (c.outcome !== "completed") return;
    try {
        const { rows } = await pool.query(`SELECT owner_id FROM salons WHERE id = $1`, [c.salonId]);
        const changedBy = actingUserId ?? rows[0]?.owner_id ?? null;
        if (c.tier && changedBy) {
            // The new plan's feature set becomes the salon's (module_plans -> salon_module_locks, the existing mechanism).
            const applied = await salonModulesService.applyPlanTier(c.salonId, c.tier, changedBy);
            logger.info("Upgrade: plan features applied", { salonId: c.salonId, tier: c.tier, applied });
        }
    } catch (err: any) {
        logger.error("Upgrade: applying plan features failed", { salonId: c.salonId, error: err?.message });
    }
    if (c.razorpaySubscriptionToCancel) {
        try {
            // Stop the old plan's automatic renewal at the end of the period it already covered.
            await ((await getRazorpay()).subscriptions as any).cancel(c.razorpaySubscriptionToCancel, true);
        } catch (err: any) {
            logger.warn("Upgrade: could not cancel the old Razorpay subscription", { sub: c.razorpaySubscriptionToCancel, error: err?.error?.description ?? err?.message });
        }
    }
    if (c.invoiceCreated && c.invoiceId) subscriptionInvoicesService.emailInvoice(c.invoiceId).catch((err) => logger.warn("Subscription invoice email failed", { invoiceId: c.invoiceId, error: err?.message }));
}

// ── gateway verification ────────────────────────────────────────────────────────────────────────────────────────────

async function signatureMatches(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    const secret = (await getRazorpayCredentials()).keySecret;
    if (!secret) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type GatewayPayment = { id: string; status: string; amount: number; currency: string; order_id: string | null; method?: string; created_at?: number };

// Ask Razorpay itself what happened to this payment. The browser's say-so (or its redirect to a success page) is never enough.
async function fetchVerifiedPayment(paymentId: string, expected: { orderId: string; amountPaise: number; currency: string }): Promise<{ state: "captured" | "pending" | "failed"; payment: GatewayPayment; reason?: string }> {
    let p: GatewayPayment;
    try {
        p = (await ((await getRazorpay()).payments as any).fetch(paymentId)) as GatewayPayment;
    } catch (err: any) {
        throw new AppError(424, `Could not confirm the payment with Razorpay: ${err?.error?.description ?? err?.message ?? "unknown error"}`, "RAZORPAY_ERROR");
    }
    if (p.order_id !== expected.orderId) return { state: "failed", payment: p, reason: "Payment does not belong to this upgrade" };
    if (p.currency !== expected.currency || Number(p.amount) !== expected.amountPaise) return { state: "failed", payment: p, reason: "Payment amount does not match the upgrade amount" };
    if (p.status === "captured") return { state: "captured", payment: p };
    if (p.status === "authorized") {
        try {
            await ((await getRazorpay()).payments as any).capture(paymentId, expected.amountPaise, expected.currency);
            return { state: "captured", payment: { ...p, status: "captured" } };
        } catch (err: any) {
            return { state: "pending", payment: p, reason: err?.error?.description ?? "Payment is authorized but not captured yet" };
        }
    }
    if (p.status === "failed") return { state: "failed", payment: p, reason: "The payment failed" };
    return { state: "pending", payment: p };   // created / refunded etc.
}

// ── public API ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function expireStalePending(db: Db, salonId: string) {
    const policy = loadUpgradePolicy();
    await db.query(
        `UPDATE subscription_upgrades SET status = 'cancelled', failure_reason = 'Payment was not completed in time'
         WHERE salon_id = $1 AND status = 'pending' AND created_at < NOW() - ($2 || ' minutes')::interval`,
        [salonId, String(policy.orderValidityMinutes)]
    );
}

const gatewayPayload = async (u: any) => ({
    key_id: (await getRazorpayCredentials()).keyId ?? "",
    order_id: u.razorpay_order_id as string,
    amount: toPaise(Number(u.total)),
    currency: (u.currency as string | undefined) ?? "INR",
});

export const subscriptionUpgradeService = {
    async quote(salonId: string, userId: string | null, tier: unknown, cycle: unknown, country?: unknown) {
        const t = parseTarget(tier, cycle);
        return quoteView(await buildQuote(pool, salonId, t.tier, t.cycle, new Date(), await resolveUpgradeCountry(pool, userId, salonId, country)));
    },

    // `expectedCurrency` is the currency of the quote the customer was shown. If the price now comes out in a different currency (for
    // example Razorpay refused the customer's own currency in the meantime), nothing is created: the page re-shows the new quote first.
    async initiate(salonId: string, userId: string, tier: unknown, cycle: unknown, country?: unknown, expectedCurrency?: unknown) {
        const t = parseTarget(tier, cycle);
        await expireStalePending(pool, salonId);
        const built = await buildQuote(pool, salonId, t.tier, t.cycle, new Date(), await resolveUpgradeCountry(pool, userId, salonId, country));
        const q = built.quote;
        if (typeof expectedCurrency === "string" && expectedCurrency && expectedCurrency.toUpperCase() !== built.currency) {
            throw new AppError(409, `The price for this upgrade has changed to ${built.currency}. Please review the new amount before paying.`, "QUOTE_CHANGED", { currency: built.currency });
        }

        // Asked again for the same upgrade at the same price (a retry): hand back the same payment instead of making a new one.
        const { rows: pending } = await pool.query(
            `SELECT * FROM subscription_upgrades WHERE salon_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [salonId]
        );
        if (pending[0]) {
            const p = pending[0];
            if (p.to_plan_id === built.target.id && toPaise(Number(p.total)) === q.totalPaise && (p.currency ?? "INR") === built.currency && p.from_subscription_id === built.current.id && p.razorpay_order_id) {
                return { upgrade_id: p.id as string, status: "pending" as const, quote: quoteView(built), payment: await gatewayPayload(p) };
            }
            await pool.query(`UPDATE subscription_upgrades SET status = 'cancelled', failure_reason = 'Replaced by a newer upgrade attempt' WHERE id = $1 AND status = 'pending'`, [p.id]);
        }

        let upgradeId: string;
        const overseas = built.currency !== "INR";   // only possible once the currency columns exist (buildQuote checks)
        try {
            const { rows } = await pool.query(
                `INSERT INTO subscription_upgrades
                    (salon_id, from_subscription_id, to_plan_id, to_tier, to_cycle, kind, period_start, period_end, total_days, remaining_days,
                     current_paid, new_plan_charge, credit_applied, subtotal, gst_percent, gst_amount, total, created_by${overseas ? ", currency, fx_rate, country_code" : ""})
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18${overseas ? ",$19,$20,$21" : ""}) RETURNING id`,
                [salonId, built.current.id, built.target.id, t.tier, t.cycle, q.kind, q.periodStart.toISOString(), q.periodEnd.toISOString(),
                 q.totalDays, q.remainingDays, fromPaise(q.currentPaidPaise), fromPaise(q.newPlanChargePaise), fromPaise(q.creditAppliedPaise),
                 fromPaise(q.subtotalPaise), q.gstPercent, fromPaise(q.gstPaise), fromPaise(q.totalPaise), userId,
                 ...(overseas ? [built.currency, built.fxRate, built.country] : [])]
            );
            upgradeId = rows[0].id;
        } catch (err: any) {
            if (err?.code === "23505") throw new AppError(409, "An upgrade is already being processed for this salon. Please try again in a moment.", "UPGRADE_IN_PROGRESS");
            throw err;
        }

        // Fully covered by credit: no payment, completed by the backend itself.
        if (q.zeroPayable) {
            const result = await inTransaction((db) => completeUpgrade(db, upgradeId, { paymentId: null, method: null, paidAt: new Date() }));
            await afterCompletion(result, userId);
            return { upgrade_id: upgradeId, status: "completed" as const, quote: quoteView(built), payment: null };
        }

        try {
            const order = await ((await getRazorpay()).orders as any).create({
                amount: q.totalPaise, currency: built.currency, receipt: `upg_${upgradeId.slice(0, 30)}`, payment_capture: 1,
                notes: { upgrade_id: upgradeId, salon_id: salonId, to: `${t.tier}-${t.cycle}`, currency: built.currency },
            });
            await pool.query(`UPDATE subscription_upgrades SET razorpay_order_id = $2 WHERE id = $1`, [upgradeId, order.id]);
            return { upgrade_id: upgradeId, status: "pending" as const, quote: quoteView(built), payment: { key_id: (await getRazorpayCredentials()).keyId ?? "", order_id: order.id as string, amount: q.totalPaise, currency: built.currency } };
        } catch (err: any) {
            await pool.query(`UPDATE subscription_upgrades SET status = 'failed', failure_reason = $2 WHERE id = $1 AND status = 'pending'`, [upgradeId, "Could not create the payment order"]);
            if (err instanceof AppError) throw err;
            // Razorpay turned the customer's own currency down (a 400, not an auth or network problem). Nothing was charged. Remember it,
            // so the next quote is in INR, and ask the page to show that new quote before anything is paid.
            if (overseas && err?.statusCode === 400) {
                markCurrencyRefused(built.currency);
                logger.warn("Razorpay refused a non-INR upgrade order", { currency: built.currency, error: err?.error?.description ?? err?.message });
                throw new AppError(409, `Payments in ${built.currency} aren't available on our payment account right now. Review the amount in INR to continue.`, "QUOTE_CHANGED", { currency: "INR" });
            }
            throw new AppError(424, `Razorpay could not start the payment: ${err?.error?.description ?? err?.message ?? "unknown error"}`, "RAZORPAY_ERROR");
        }
    },

    // The browser reports a finished payment. We trust none of it: check the signature, then ask Razorpay what really happened.
    async verify(salonId: string, upgradeId: string, body: { razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown }, userId: string | null) {
        const orderId = String(body.razorpay_order_id ?? "");
        const paymentId = String(body.razorpay_payment_id ?? "");
        const signature = String(body.razorpay_signature ?? "");
        if (!orderId || !paymentId || !signature) throw new AppError(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required", "VALIDATION_ERROR");

        const { rows } = await pool.query(`SELECT * FROM subscription_upgrades WHERE id = $1 AND salon_id = $2`, [upgradeId, salonId]);
        const u = rows[0];
        if (!u) throw new AppError(404, "Upgrade not found", "NOT_FOUND");
        if (u.status === "completed") return { status: "completed" as const, already: true };
        if (u.status !== "pending") throw new AppError(409, `This upgrade is ${u.status} and can't be completed.`, "UPGRADE_NOT_PENDING");
        if (!u.razorpay_order_id || u.razorpay_order_id !== orderId) throw new AppError(400, "That payment is for a different order", "ORDER_MISMATCH");
        if (!(await signatureMatches(orderId, paymentId, signature))) throw new AppError(400, "Payment signature could not be verified", "INVALID_SIGNATURE");

        const verified = await fetchVerifiedPayment(paymentId, { orderId, amountPaise: toPaise(Number(u.total)), currency: u.currency ?? "INR" });
        if (verified.state === "failed") {
            await pool.query(`UPDATE subscription_upgrades SET failure_reason = $2 WHERE id = $1 AND status = 'pending'`, [upgradeId, verified.reason ?? "Payment failed"]);
            throw new AppError(402, verified.reason ?? "The payment was not successful.", "PAYMENT_FAILED");
        }
        if (verified.state === "pending") return { status: "pending" as const, already: false };

        const result = await inTransaction((db) =>
            completeUpgrade(db, upgradeId, { paymentId, method: verified.payment.method ?? null, paidAt: verified.payment.created_at ? new Date(verified.payment.created_at * 1000) : new Date() })
        );
        await afterCompletion(result, userId);
        if (result.outcome === "needs_review") throw new AppError(409, "Your payment was received but needs a quick review before the plan changes. Our team has been notified.", "UPGRADE_NEEDS_REVIEW");
        return { status: "completed" as const, already: result.outcome === "already_completed" };
    },

    async cancel(salonId: string, upgradeId: string) {
        const { rows } = await pool.query(
            `UPDATE subscription_upgrades SET status = 'cancelled', failure_reason = 'Cancelled by the salon'
             WHERE id = $1 AND salon_id = $2 AND status = 'pending' RETURNING id`,
            [upgradeId, salonId]
        );
        if (rows[0]) return { cancelled: true };
        const { rows: cur } = await pool.query(`SELECT status FROM subscription_upgrades WHERE id = $1 AND salon_id = $2`, [upgradeId, salonId]);
        if (!cur[0]) throw new AppError(404, "Upgrade not found", "NOT_FOUND");
        if (cur[0].status === "completed") throw new AppError(409, "This upgrade has already been completed.", "ALREADY_COMPLETED");
        return { cancelled: false };
    },

    // Razorpay -> us for order / payment events. Safe to receive repeatedly and out of order.
    async handleGatewayEvent(event: any): Promise<string> {
        const type: string = event?.event ?? "";
        const pay = event?.payload?.payment?.entity;
        const orderId: string | undefined = pay?.order_id ?? event?.payload?.order?.entity?.id;
        if (!orderId) return `ignored (${type || "no order"})`;

        const { rows } = await pool.query(`SELECT * FROM subscription_upgrades WHERE razorpay_order_id = $1`, [orderId]);
        const u = rows[0];
        if (!u) return "ignored (not an upgrade order)";

        if (type === "payment.failed") {
            await pool.query(`UPDATE subscription_upgrades SET failure_reason = $2 WHERE id = $1 AND status = 'pending'`,
                [u.id, pay?.error_description ?? "A payment attempt failed"]);
            return "upgrade payment attempt failed (the order stays open for a retry)";
        }
        if (type !== "payment.captured" && type !== "order.paid") return `ignored (${type})`;
        if (!pay?.id) return "ignored (no payment in event)";

        // Same checks as the browser path, applied to the gateway's own payload.
        if (pay.currency !== (u.currency ?? "INR") || Number(pay.amount) !== toPaise(Number(u.total)) || pay.status !== "captured") {
            await pool.query(`UPDATE subscription_upgrades SET status = 'needs_review', razorpay_payment_id = $2, failure_reason = 'Payment amount or status did not match the upgrade' WHERE id = $1 AND status = 'pending'`, [u.id, pay.id]);
            return "upgrade payment did not match: needs review";
        }
        const result = await inTransaction((db) =>
            completeUpgrade(db, u.id, { paymentId: pay.id, method: pay.method ?? null, paidAt: pay.created_at ? new Date(pay.created_at * 1000) : new Date() })
        );
        await afterCompletion(result, null);
        return result.outcome === "completed" ? "upgrade completed" : `upgrade ${result.outcome.replace("_", " ")}`;
    },
};
