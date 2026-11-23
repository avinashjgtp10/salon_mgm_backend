import crypto from "crypto";
import type { PoolClient } from "pg";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpay, getRazorpayCredentials } from "../../config/razorpay";
import { PLATFORM_BILLING_CURRENCY } from "../../config/currency";
import { salonModulesService } from "../salon-modules/salon-modules.service";
import { subscriptionInvoicesRepository as invoiceRepo } from "../subscription-invoices/subscription-invoices.repository";
import { subscriptionInvoicesService } from "../subscription-invoices/subscription-invoices.service";
import { dbDate, tierOfPlan } from "../subscription-billing/plan-tier";
import { deriveSubscriptionState, isLiveState } from "../subscription-billing/subscription-status";
import { loadSalonSubscriptions, pickCurrentSubscription, subscriptionEnd } from "../subscription-billing/subscription-billing.service";
import {
    addDuration, cleanOption, decidePurchase, remainingDays, toPaise, DURATION_TIERS,
    type CurrentTerm, type DurationTier, type DurationUnit, type PurchaseKind,
} from "./duration-pricing";

// Dynamic subscription durations. The salon never sends an amount: it names an option, the server reads that option's price from
// the database, snapshots it on a pending order, creates the Razorpay order for exactly that amount, and ONLY activates the term
// after the payment has been verified (signature + Razorpay's own record of the payment). Activation is idempotent: the order row
// is locked and leaves 'pending' once, and one Razorpay payment id can belong to one order, so a repeated webhook, a double click
// or the webhook racing the browser can never grant two terms. Existing subscriptions are never edited (see decidePurchase).

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

// No new tables: a term is a subscription_plans row, a purchase is a subscription_payments row (both extended by
// Migration/add_subscription_durations_to_existing_tables.sql, run by hand per environment). Until it has been run, every route here
// answers a clear 503 instead of a database error, and nothing else in the app is affected.
let tablesReady = false;
async function requireTables(): Promise<void> {
    if (tablesReady) return;
    const { rows } = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'subscription_plans' AND column_name IN ('duration_value', 'is_archived')) AS plan_cols,
                (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'subscription_payments' AND column_name IN ('razorpay_order_id', 'duration_value', 'plan_id')) AS pay_cols,
                (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = 'duration_order_id') AS sub_cols`
    );
    const r = rows[0];
    if (r?.plan_cols !== 2 || r?.pay_cols !== 3 || r?.sub_cols !== 1) {
        throw new AppError(503, "Subscription durations are not set up on this database yet (migration add_subscription_durations_to_existing_tables.sql).", "DURATIONS_NOT_MIGRATED");
    }
    tablesReady = true;
}

// A purchase (order) is a subscription_payments row. These aliases give it the vocabulary used below; payment_status 'paid' reads as
// 'completed' here, so the logic and the API keep one set of words.
const ORDER_SELECT = `SELECT p.*, CASE p.payment_status WHEN 'paid' THEN 'completed' ELSE p.payment_status END AS status, p.purchase_kind AS kind,
        p.duration_label AS label, p.amount AS total, pl.tier AS tier
     FROM subscription_payments p LEFT JOIN subscription_plans pl ON pl.id = p.plan_id`;
const TERM_ROWS = `duration_value IS NOT NULL AND is_archived = FALSE`;

const optionView = (r: any) => ({
    id: r.id as string,
    tier: r.tier as DurationTier,
    label: r.duration_label as string,
    duration_value: Number(r.duration_value),
    duration_unit: r.duration_unit as DurationUnit,
    base_price: Number(r.price),   // subscription_plans.price is the price BEFORE GST
    gst_percent: Number(r.gst_percent),
    gst_amount: Number(r.gst_amount),
    final_price: Number(r.final_price),
    is_active: Boolean(r.is_active),
    is_recommended: Boolean(r.is_recommended),
    sort_order: Number(r.sort_order),
    /** What one month costs on this option (final price / months), so the best value can be seen. Days count as 1/30 of a month. */
    monthly_equivalent: Math.round((Number(r.final_price) / (r.duration_unit === "days" ? Number(r.duration_value) / 30 : r.duration_unit === "years" ? Number(r.duration_value) * 12 : Number(r.duration_value))) * 100) / 100,
});

const OPTION_ORDER = `ORDER BY CASE tier WHEN 'basic' THEN 1 WHEN 'advance' THEN 2 ELSE 3 END,
    (duration_value * CASE duration_unit WHEN 'days' THEN 1 WHEN 'months' THEN 30 ELSE 365 END), sort_order, created_at`;

// A purchased term's subscription points at the term's own subscription_plans row; that row's tier decides the plan and its features
// (applyPlanTier). A row that has been bought is never rewritten or deleted: it is archived (see update / remove).
const termSlug = (tier: string, value: number, unit: string) => `duration-${tier}-${value}-${unit}`;
const planName = (tier: string) => `SalonOx ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;

async function isInUse(db: Db, planId: string): Promise<boolean> {
    const { rows } = await db.query(
        `SELECT (EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = $1) OR EXISTS (SELECT 1 FROM subscription_payments WHERE plan_id = $1)) AS used`, [planId]
    );
    return Boolean(rows[0]?.used);
}
const archive = (db: Db, id: string) =>
    db.query(
        `UPDATE subscription_plans SET is_archived = TRUE, is_active = FALSE, is_recommended = FALSE,
                slug = slug || '-archived-' || to_char(NOW(), 'YYYYMMDDHH24MISSMS') WHERE id = $1`, [id]
    );

/** The salon's current term, in the shape decidePurchase wants. */
async function currentTerm(db: Db, salonId: string, now: Date): Promise<{ term: CurrentTerm | null; liveRows: { id: string; razorpay_subscription_id: string | null; trial: boolean }[] }> {
    const subs = await loadSalonSubscriptions(db as never, salonId);
    const live = subs.filter((s) => isLiveState(deriveSubscriptionState({ status: s.status, periodEnd: subscriptionEnd(s), now, salonActive: true })));
    const cur = pickCurrentSubscription(subs, now);
    if (!cur || !live.some((s) => s.id === cur.id)) return { term: null, liveRows: [] };
    return {
        term: {
            tier: tierOfPlan({ tier: cur.plan_tier, name: cur.plan_name, slug: cur.plan_slug }) as DurationTier | null,
            end: subscriptionEnd(cur), live: true, trial: cur.is_trial || cur.status === "trialing",
        },
        liveRows: live.map((s) => ({ id: s.id, razorpay_subscription_id: s.razorpay_subscription_id, trial: s.is_trial || s.status === "trialing" })),
    };
}

// ── Razorpay verification ─────────────────────────────────────────────────────────────────────────────────────────────────
async function signatureMatches(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    const secret = (await getRazorpayCredentials()).keySecret;
    if (!secret) return false;
    const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type GatewayPayment = { id: string; status: string; amount: number; currency: string; order_id: string | null; method?: string; created_at?: number };

// Never trust the browser's "I paid": ask Razorpay for the payment and check it is captured, for THIS order, and for exactly the stored amount.
async function fetchVerifiedPayment(paymentId: string, expect: { orderId: string; amountPaise: number; currency: string }):
    Promise<{ state: "paid"; payment: GatewayPayment } | { state: "pending" } | { state: "failed"; reason: string }> {
    let p: GatewayPayment;
    try {
        p = await ((await getRazorpay()).payments as any).fetch(paymentId);
    } catch (err: any) {
        throw new AppError(424, `Razorpay could not confirm the payment: ${err?.error?.description ?? err?.message ?? "unknown error"}`, "RAZORPAY_ERROR");
    }
    if (p.order_id !== expect.orderId) return { state: "failed", reason: "The payment belongs to a different order." };
    if (Number(p.amount) !== expect.amountPaise || p.currency !== expect.currency) return { state: "failed", reason: "The paid amount does not match the order." };
    if (p.status === "captured") return { state: "paid", payment: p };
    if (p.status === "failed") return { state: "failed", reason: "The payment failed." };
    return { state: "pending" };   // created / authorized: not money received yet
}

// ── activation ────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Completion {
    outcome: "completed" | "already_completed" | "needs_review" | "not_pending" | "not_found";
    reason?: string;
    salonId?: string; tier?: DurationTier; ownerId?: string | null;
    invoiceId?: string; invoiceCreated?: boolean;
    razorpaySubscriptionsToStop?: string[];
    subscriptionId?: string; periodStart?: Date; periodEnd?: Date; kind?: PurchaseKind;
}

async function completeOrder(db: PoolClient, orderId: string, pay: { paymentId: string; method: string | null; paidAt: Date; signatureVerified: boolean }): Promise<Completion> {
    const { rows } = await db.query(`${ORDER_SELECT} WHERE p.id = $1 AND p.duration_value IS NOT NULL FOR UPDATE OF p`, [orderId]);
    const o = rows[0];
    if (!o) return { outcome: "not_found" };
    if (o.status === "completed") return { outcome: "already_completed", salonId: o.salon_id };

    const park = async (reason: string): Promise<Completion> => {
        await db.query(
            `UPDATE subscription_payments SET payment_status = 'needs_review', razorpay_payment_id = COALESCE(razorpay_payment_id, $2), failure_reason = $3 WHERE id = $1`,
            [orderId, pay.paymentId, reason]
        );
        logger.error("Duration order payment needs review", { orderId, paymentId: pay.paymentId, reason });
        return { outcome: "needs_review", reason, salonId: o.salon_id };
    };
    if (o.status !== "pending") return o.status === "needs_review" ? { outcome: "needs_review", reason: o.failure_reason, salonId: o.salon_id } : { outcome: "not_pending", reason: `Order is ${o.status}`, salonId: o.salon_id };

    // The same Razorpay payment may never activate a second order.
    const dupe = await db.query(`SELECT 1 FROM subscription_payments WHERE razorpay_payment_id = $1 AND id <> $2`, [pay.paymentId, orderId]);
    if (dupe.rows[0]) return park("This payment was already used for another order");

    // One activation at a time per salon, so two orders finishing together cannot both read the same "current term".
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sub-duration:${o.salon_id}`]);

    const now = new Date();
    const { term, liveRows } = await currentTerm(db, o.salon_id, now);
    const decision = decidePurchase(term, o.tier, now);
    if ("refused" in decision) return park(decision.refused);

    if (!o.plan_id) return park("The purchased plan no longer exists");
    const planId = o.plan_id as string;
    const start = decision.start;
    const end = addDuration(start, Number(o.duration_value), o.duration_unit);

    // A new term or an upgrade replaces what is live now: the old rows stay as history (marked, never deleted or edited otherwise).
    // A renewal leaves the current row alone: the new term simply starts when it ends.
    if (decision.kind === "upgrade") {
        await db.query(`UPDATE subscriptions SET status = 'upgraded', cancel_at_period_end = TRUE, updated_at = NOW() WHERE salon_id = $1 AND status IN ('active', 'trialing')`, [o.salon_id]);
    } else if (decision.kind === "new") {
        await db.query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE salon_id = $1 AND status = 'trialing'`, [o.salon_id]);
    }

    const ins = await db.query(
        `INSERT INTO subscriptions
            (salon_id, user_id, plan_id, status, is_trial, cancel_at_period_end, current_period_start, current_period_end,
             duration_order_id, duration_label, duration_value, duration_unit,
             purchase_base_price, purchase_gst_percent, purchase_gst_amount, purchase_total)
         VALUES ($1, $2, $3, 'active', FALSE, FALSE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [o.salon_id, o.user_id, planId, start.toISOString(), end.toISOString(), o.id, o.label, o.duration_value, o.duration_unit,
         o.base_price, o.gst_percent, o.gst_amount, o.total]
    );
    const subscriptionId = ins.rows[0].id as string;

    // The purchase record itself becomes the paid payment, linked to the new subscription (transaction_id = Razorpay payment id, as everywhere else).
    await db.query(
        `UPDATE subscription_payments
         SET payment_status = 'paid', razorpay_payment_id = $2, transaction_id = $2, payment_method = $3, signature_verified = $4, subscription_id = $5,
             period_start = $6, period_end = $7, billing_period_start = $6::timestamptz::date, billing_period_end = $7::timestamptz::date,
             paid_at = $8, purchase_kind = $9, failure_reason = NULL, completed_at = NOW()
         WHERE id = $1`,
        [orderId, pay.paymentId, pay.method, pay.signatureVerified, subscriptionId, start.toISOString(), end.toISOString(), pay.paidAt.toISOString(), decision.kind]
    );

    // The tax invoice, from the stored (snapshotted) GST. Its cycle column carries the term's own label ("3 Months", "45 Days").
    const invoice = await invoiceRepo.createFromPayment(db, orderId, Number(o.gst_percent), o.user_id ?? null);
    if (invoice?.created) {
        await db.query(`UPDATE subscription_invoices SET billing_cycle = $2, plan_name = COALESCE(plan_name, $3) WHERE id = $1`, [invoice.id, String(o.label).slice(0, 20), `SalonOx ${o.tier}`]);
    }

    return {
        outcome: "completed", salonId: o.salon_id, tier: o.tier, ownerId: o.user_id, kind: decision.kind, subscriptionId, periodStart: start, periodEnd: end,
        invoiceId: invoice?.id, invoiceCreated: invoice?.created,
        // A recurring Razorpay subscription would charge again at its own renewal, on top of this prepaid term: stop it at the end of the period it already covers.
        razorpaySubscriptionsToStop: liveRows.map((r) => r.razorpay_subscription_id).filter((x): x is string => Boolean(x)),
    };
}

// Everything that happens after the money and the term are safely committed. Each step is best-effort and logged; none can undo the purchase.
async function afterCompletion(c: Completion) {
    if (c.outcome !== "completed" || !c.salonId) return;
    try {
        const { rows } = await pool.query(`SELECT owner_id FROM salons WHERE id = $1`, [c.salonId]);
        const changedBy = c.ownerId ?? rows[0]?.owner_id ?? null;
        // Features and permissions: the purchased tier's module_plans entry (the same mechanism every other plan change uses). A renewal
        // keeps the same tier, so this re-applies the same set.
        if (c.tier && changedBy) {
            const applied = await salonModulesService.applyPlanTier(c.salonId, c.tier, changedBy);
            logger.info("Duration purchase: plan features applied", { salonId: c.salonId, tier: c.tier, applied });
        }
    } catch (err: any) {
        logger.error("Duration purchase: applying plan features failed", { salonId: c.salonId, error: err?.message });
    }
    for (const rzpId of c.razorpaySubscriptionsToStop ?? []) {
        try { await ((await getRazorpay()).subscriptions as any).cancel(rzpId, true); }
        catch (err: any) { logger.warn("Duration purchase: could not stop the old recurring subscription", { rzpId, error: err?.error?.description ?? err?.message }); }
    }
    if (c.invoiceCreated && c.invoiceId) {
        subscriptionInvoicesService.emailInvoice(c.invoiceId).catch((err) => logger.warn("Subscription invoice email failed", { invoiceId: c.invoiceId, error: err?.message }));
    }
}

const orderView = (o: any) => ({
    id: o.id as string,
    status: o.status as string,
    kind: o.kind as PurchaseKind,
    tier: o.tier as DurationTier,
    label: o.label as string,
    base_price: Number(o.base_price), gst_percent: Number(o.gst_percent), gst_amount: Number(o.gst_amount), total: Number(o.total),
    period_start: o.period_start ? dbDate(o.period_start)?.toISOString() ?? null : null,
    period_end: o.period_end ? dbDate(o.period_end)?.toISOString() ?? null : null,
    created_at: dbDate(o.created_at)?.toISOString() ?? null,
});

export const subscriptionDurationsService = {
    // ── Super Admin: manage options ───────────────────────────────────────────────────────────────────────────────────────
    async listAll() {
        await requireTables();
        const { rows } = await pool.query(`SELECT * FROM subscription_plans WHERE ${TERM_ROWS} ${OPTION_ORDER}`);
        return rows.map(optionView);
    },

    async create(body: any, _adminId: string | null) {
        await requireTables();
        const parsed = cleanOption({ tier: body?.tier, durationValue: body?.duration_value, durationUnit: body?.duration_unit, basePrice: body?.base_price, gstPercent: body?.gst_percent, label: body?.label });
        if (!parsed.ok) throw new AppError(400, parsed.message, "VALIDATION_ERROR");
        const v = parsed.value;
        return inTransaction(async (db) => {
            try {
                const { rows } = await db.query(
                    `INSERT INTO subscription_plans
                        (name, slug, description, price, billing_cycle, is_active, tier, duration_label, duration_value, duration_unit,
                         gst_percent, gst_amount, final_price, is_recommended, sort_order)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,$14) RETURNING *`,
                    [planName(v.tier), termSlug(v.tier, v.durationValue, v.durationUnit), `Prepaid ${v.label}`, v.basePrice, v.label.slice(0, 20), body?.is_active !== false, v.tier,
                     v.label, v.durationValue, v.durationUnit, v.gstPercent, v.gstAmount, v.finalPrice, Number(body?.sort_order) || 0]
                );
                if (body?.is_recommended === true) await db.query(`UPDATE subscription_plans SET is_recommended = (id = $2) WHERE tier = $1 AND ${TERM_ROWS}`, [v.tier, rows[0].id]);
                const { rows: fresh } = await db.query(`SELECT * FROM subscription_plans WHERE id = $1`, [rows[0].id]);
                return optionView(fresh[0]);
            } catch (err: any) {
                if (err?.code === "23505") throw new AppError(409, "This plan already has an option with that duration. Edit it instead.", "DUPLICATE_OPTION");
                throw err;
            }
        });
    },

    // Editing an option changes only FUTURE purchases. A term that somebody has already bought is never rewritten (the plan row it points at
    // would change under them): the old row is archived as history and a fresh row takes its place. Switching it on/off, recommending it or
    // re-ordering it does not touch what was bought, so those are done in place.
    async update(id: string, body: any) {
        await requireTables();
        const { rows: cur } = await pool.query(`SELECT * FROM subscription_plans WHERE id = $1 AND ${TERM_ROWS}`, [id]);
        if (!cur[0]) throw new AppError(404, "Option not found", "NOT_FOUND");
        const c = cur[0];
        const parsed = cleanOption({
            tier: c.tier,   // the plan of an option is fixed; create a new option for another plan
            durationValue: body?.duration_value ?? c.duration_value, durationUnit: body?.duration_unit ?? c.duration_unit,
            basePrice: body?.base_price ?? c.price, gstPercent: body?.gst_percent ?? c.gst_percent, label: body?.label ?? c.duration_label,
        });
        if (!parsed.ok) throw new AppError(400, parsed.message, "VALIDATION_ERROR");
        const v = parsed.value;
        const isActive = typeof body?.is_active === "boolean" ? body.is_active : Boolean(c.is_active);
        const sortOrder = body?.sort_order !== undefined && Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : Number(c.sort_order);
        const recommended = typeof body?.is_recommended === "boolean" ? body.is_recommended : Boolean(c.is_recommended);
        const termChanged = v.durationValue !== Number(c.duration_value) || v.durationUnit !== c.duration_unit || v.basePrice !== Number(c.price)
            || v.gstPercent !== Number(c.gst_percent) || v.label !== c.duration_label;

        return inTransaction(async (db) => {
            try {
                let rowId = id;
                if (termChanged && (await isInUse(db, id))) {
                    await archive(db, id);
                    const ins = await db.query(
                        `INSERT INTO subscription_plans
                            (name, slug, description, price, billing_cycle, is_active, tier, duration_label, duration_value, duration_unit,
                             gst_percent, gst_amount, final_price, is_recommended, sort_order)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,FALSE,$14) RETURNING id`,
                        [planName(v.tier), termSlug(v.tier, v.durationValue, v.durationUnit), `Prepaid ${v.label}`, v.basePrice, v.label.slice(0, 20), isActive, v.tier,
                         v.label, v.durationValue, v.durationUnit, v.gstPercent, v.gstAmount, v.finalPrice, sortOrder]
                    );
                    rowId = ins.rows[0].id as string;
                } else {
                    await db.query(
                        `UPDATE subscription_plans
                         SET slug = $2, description = $3, price = $4, billing_cycle = $5, is_active = $6, duration_label = $7, duration_value = $8, duration_unit = $9,
                             gst_percent = $10, gst_amount = $11, final_price = $12, sort_order = $13
                         WHERE id = $1`,
                        [id, termSlug(v.tier, v.durationValue, v.durationUnit), `Prepaid ${v.label}`, v.basePrice, v.label.slice(0, 20), isActive,
                         v.label, v.durationValue, v.durationUnit, v.gstPercent, v.gstAmount, v.finalPrice, sortOrder]
                    );
                }
                if (recommended) await db.query(`UPDATE subscription_plans SET is_recommended = (id = $2) WHERE tier = $1 AND ${TERM_ROWS}`, [c.tier, rowId]);
                else await db.query(`UPDATE subscription_plans SET is_recommended = FALSE WHERE id = $1`, [rowId]);
                const { rows } = await db.query(`SELECT * FROM subscription_plans WHERE id = $1`, [rowId]);
                return optionView(rows[0]);
            } catch (err: any) {
                if (err?.code === "23505") throw new AppError(409, "This plan already has an option with that duration.", "DUPLICATE_OPTION");
                throw err;
            }
        });
    },

    // A term nobody has bought is deleted; one that has been bought is archived (stops being offered, stays as history).
    async remove(id: string) {
        await requireTables();
        const { rows } = await pool.query(`SELECT id FROM subscription_plans WHERE id = $1 AND ${TERM_ROWS}`, [id]);
        if (!rows[0]) throw new AppError(404, "Option not found", "NOT_FOUND");
        if (await isInUse(pool, id)) await archive(pool, id);
        else await pool.query(`DELETE FROM subscription_plans WHERE id = $1`, [id]);
        return { deleted: true };
    },

    // ── Salon owner: what can be bought ───────────────────────────────────────────────────────────────────────────────────
    /** Active options grouped by plan. Empty (never an error) when nothing is configured or the migration has not run, so the page just hides the section. */
    async listPublic() {
        try { await requireTables(); } catch (err) {
            if (err instanceof AppError && err.code === "DURATIONS_NOT_MIGRATED") return DURATION_TIERS.map((tier) => ({ tier, options: [] as ReturnType<typeof optionView>[] }));
            throw err;
        }
        const { rows } = await pool.query(`SELECT * FROM subscription_plans WHERE is_active = TRUE AND ${TERM_ROWS} ${OPTION_ORDER}`);
        const all = rows.map(optionView);
        return DURATION_TIERS.map((tier) => {
            const options = all.filter((o) => o.tier === tier);
            // Best value = the cheapest per-month price, shown only when there is something to compare it with.
            const cheapest = options.length > 1 ? options.reduce((a, b) => (b.monthly_equivalent < a.monthly_equivalent ? b : a)) : null;
            return { tier, options: options.map((o) => ({ ...o, best_value: cheapest?.id === o.id })) };
        });
    },

    // ── Salon owner: buy ──────────────────────────────────────────────────────────────────────────────────────────────────
    async createOrder(salonId: string, userId: string, optionId: unknown) {
        await requireTables();
        if (typeof optionId !== "string" || !optionId) throw new AppError(400, "option_id is required", "VALIDATION_ERROR");
        const { rows: opt } = await pool.query(`SELECT * FROM subscription_plans WHERE id = $1 AND is_active = TRUE AND ${TERM_ROWS}`, [optionId]);
        const o = opt[0];
        if (!o) throw new AppError(404, "That option is not available any more.", "OPTION_UNAVAILABLE");

        const now = new Date();
        const { term } = await currentTerm(pool, salonId, now);
        const decision = decidePurchase(term, o.tier, now);
        if ("refused" in decision) throw new AppError(409, decision.refused, "PLAN_DOWNGRADE_NOT_ALLOWED");
        const end = addDuration(decision.start, Number(o.duration_value), o.duration_unit);

        // An older unpaid attempt is replaced by this one.
        await pool.query(`UPDATE subscription_payments SET payment_status = 'cancelled', failure_reason = 'Replaced by a newer purchase attempt' WHERE salon_id = $1 AND payment_status = 'pending' AND duration_value IS NOT NULL`, [salonId]);

        // The purchase record: the term's price, GST and length are copied here, so editing the term later never rewrites this purchase.
        const { rows } = await pool.query(
            `INSERT INTO subscription_payments
                (salon_id, user_id, plan_id, purchase_kind, duration_label, duration_value, duration_unit, base_price, gst_percent, gst_amount, amount, currency, payment_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING id`,
            [salonId, userId, o.id, decision.kind, o.duration_label, o.duration_value, o.duration_unit, o.price, o.gst_percent, o.gst_amount, o.final_price, PLATFORM_BILLING_CURRENCY]
        );
        const orderId = rows[0].id as string;

        try {
            const order = await ((await getRazorpay()).orders as any).create({
                amount: toPaise(Number(o.final_price)), currency: PLATFORM_BILLING_CURRENCY, receipt: `dur_${orderId.slice(0, 30)}`, payment_capture: 1,
                notes: { duration_order_id: orderId, salon_id: salonId, tier: o.tier, duration: o.label },
            });
            await pool.query(`UPDATE subscription_payments SET razorpay_order_id = $2 WHERE id = $1`, [orderId, order.id]);
            return {
                order_id: orderId,
                kind: decision.kind as PurchaseKind,
                summary: {
                    tier: o.tier as DurationTier, label: o.duration_label as string, base_price: Number(o.price), gst_percent: Number(o.gst_percent),
                    gst_amount: Number(o.gst_amount), total: Number(o.final_price),
                    starts_at: decision.start.toISOString(), ends_at: end.toISOString(),
                },
                payment: { key_id: (await getRazorpayCredentials()).keyId ?? "", order_id: order.id as string, amount: toPaise(Number(o.final_price)), currency: PLATFORM_BILLING_CURRENCY },
            };
        } catch (err: any) {
            await pool.query(`UPDATE subscription_payments SET payment_status = 'failed', failure_reason = 'Could not create the payment order' WHERE id = $1 AND payment_status = 'pending'`, [orderId]);
            if (err instanceof AppError) throw err;
            throw new AppError(424, `Razorpay could not start the payment: ${err?.error?.description ?? err?.message ?? "unknown error"}`, "RAZORPAY_ERROR");
        }
    },

    // The browser reports a finished payment. We trust none of it: check the signature, then ask Razorpay what really happened.
    async verify(salonId: string, orderId: string, body: { razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown }) {
        await requireTables();
        const rzOrder = String(body.razorpay_order_id ?? "");
        const paymentId = String(body.razorpay_payment_id ?? "");
        const signature = String(body.razorpay_signature ?? "");
        if (!rzOrder || !paymentId || !signature) throw new AppError(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required", "VALIDATION_ERROR");

        const { rows } = await pool.query(`${ORDER_SELECT} WHERE p.id = $1 AND p.salon_id = $2 AND p.duration_value IS NOT NULL`, [orderId, salonId]);
        const o = rows[0];
        if (!o) throw new AppError(404, "Order not found", "NOT_FOUND");
        if (o.status === "completed") return { status: "completed" as const, already: true, order: orderView(o) };
        if (o.status !== "pending") throw new AppError(409, `This order is ${o.status} and can't be completed.`, "ORDER_NOT_PENDING");
        if (!o.razorpay_order_id || o.razorpay_order_id !== rzOrder) throw new AppError(400, "That payment is for a different order", "ORDER_MISMATCH");
        if (!(await signatureMatches(rzOrder, paymentId, signature))) throw new AppError(400, "Payment signature could not be verified", "INVALID_SIGNATURE");

        const verified = await fetchVerifiedPayment(paymentId, { orderId: rzOrder, amountPaise: toPaise(Number(o.total)), currency: o.currency });
        if (verified.state === "failed") {
            await pool.query(`UPDATE subscription_payments SET failure_reason = $2 WHERE id = $1 AND payment_status = 'pending'`, [orderId, verified.reason]);
            throw new AppError(402, verified.reason, "PAYMENT_FAILED");
        }
        if (verified.state === "pending") return { status: "pending" as const, already: false };

        const result = await inTransaction((db) =>
            completeOrder(db, orderId, { paymentId, method: verified.payment.method ?? null, paidAt: verified.payment.created_at ? new Date(verified.payment.created_at * 1000) : new Date(), signatureVerified: true })
        );
        await afterCompletion(result);
        if (result.outcome === "needs_review") throw new AppError(409, "Your payment was received but needs a quick review before the plan starts. Our team has been notified.", "ORDER_NEEDS_REVIEW");
        const { rows: fresh } = await pool.query(`${ORDER_SELECT} WHERE p.id = $1`, [orderId]);
        return { status: "completed" as const, already: result.outcome === "already_completed", order: orderView(fresh[0]) };
    },

    async cancel(salonId: string, orderId: string) {
        await requireTables();
        const { rows } = await pool.query(
            `UPDATE subscription_payments SET payment_status = 'cancelled', failure_reason = 'Cancelled by the salon' WHERE id = $1 AND salon_id = $2 AND payment_status = 'pending' AND duration_value IS NOT NULL RETURNING id`,
            [orderId, salonId]
        );
        return { cancelled: Boolean(rows[0]) };
    },

    /** The salon's recent duration purchases (newest first), for the Billing page. */
    async listForSalon(salonId: string) {
        try { await requireTables(); } catch { return []; }
        const { rows } = await pool.query(`${ORDER_SELECT} WHERE p.salon_id = $1 AND p.duration_value IS NOT NULL AND p.payment_status IN ('paid', 'needs_review') ORDER BY p.created_at DESC LIMIT 20`, [salonId]);
        return rows.map(orderView);
    },

    /** Start, expiry and days left for the term the salon is on (only when it was bought as a duration option). */
    async currentSnapshot(salonId: string) {
        try { await requireTables(); } catch { return null; }
        const now = new Date();
        const subs = await loadSalonSubscriptions(pool as never, salonId);
        const cur = pickCurrentSubscription(subs, now);
        if (!cur) return null;
        const { rows } = await pool.query(
            `SELECT duration_label, duration_value, duration_unit, purchase_base_price, purchase_gst_percent, purchase_gst_amount, purchase_total FROM subscriptions WHERE id = $1`, [cur.id]
        );
        const r = rows[0];
        if (!r?.duration_label) return null;
        const end = subscriptionEnd(cur);
        return {
            label: r.duration_label as string, duration_value: Number(r.duration_value), duration_unit: r.duration_unit as DurationUnit,
            base_price: Number(r.purchase_base_price), gst_percent: Number(r.purchase_gst_percent), gst_amount: Number(r.purchase_gst_amount), total: Number(r.purchase_total),
            starts_at: cur.current_period_start?.toISOString() ?? null, ends_at: end?.toISOString() ?? null,
            days_remaining: end ? remainingDays(end, now) : 0,
        };
    },

    // ── Razorpay -> us (order / payment events). Returns null when the event is not about a duration order, so the caller can pass it on. ──
    async handleGatewayEvent(event: any): Promise<string | null> {
        const type: string = event?.event ?? "";
        const pay = event?.payload?.payment?.entity;
        const rzOrderId: string | undefined = pay?.order_id ?? event?.payload?.order?.entity?.id;
        if (!rzOrderId) return null;
        try { await requireTables(); } catch { return null; }

        const { rows } = await pool.query(`${ORDER_SELECT} WHERE p.razorpay_order_id = $1 AND p.duration_value IS NOT NULL`, [rzOrderId]);
        const o = rows[0];
        if (!o) return null;

        if (type === "payment.failed") {
            await pool.query(`UPDATE subscription_payments SET failure_reason = $2 WHERE id = $1 AND payment_status = 'pending'`, [o.id, pay?.error_description ?? "A payment attempt failed"]);
            return "duration payment attempt failed (the order stays open for a retry)";
        }
        if (type !== "payment.captured" && type !== "order.paid") return `ignored (${type})`;
        if (!pay?.id) return "ignored (no payment in event)";

        // Same checks as the browser path, applied to the gateway's own signed payload.
        if (pay.currency !== o.currency || Number(pay.amount) !== toPaise(Number(o.total)) || pay.status !== "captured") {
            await pool.query(`UPDATE subscription_payments SET payment_status = 'needs_review', razorpay_payment_id = COALESCE(razorpay_payment_id, $2), failure_reason = 'Payment amount or status did not match the order' WHERE id = $1 AND payment_status = 'pending'`, [o.id, pay.id]);
            return "duration payment did not match: needs review";
        }
        const result = await inTransaction((db) =>
            completeOrder(db, o.id, { paymentId: pay.id, method: pay.method ?? null, paidAt: pay.created_at ? new Date(pay.created_at * 1000) : new Date(), signatureVerified: true })
        );
        await afterCompletion(result);
        return result.outcome === "completed" ? "duration term activated" : `duration order ${result.outcome.replace("_", " ")}`;
    },
};
