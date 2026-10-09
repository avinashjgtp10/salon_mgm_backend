import crypto from "crypto";
import type { PoolClient } from "pg";
import Razorpay from "razorpay";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { invalidatePlanFeatureCache } from "../../middleware/planFeature.middleware";
import { isSubscriptionActionAllowed } from "../../middleware/subscriptionPermission.middleware";
import {
    planDefinitionsRepository,
    planPricesRepository,
    salonCustomizationsRepository,
    salonPlanInvoicesRepository,
} from "../salon-plans/salon-plans.repository";
import { salonPlansService } from "../salon-plans/salon-plans.service";
import {
    BILLING_CYCLES,
    BillingCycle,
    GST_RATE_PERCENT,
    PLAN_TIER_ORDER,
    PlanTier,
} from "../salon-plans/salon-plans.types";

// Self-serve plan payments: Razorpay Orders + Checkout, one-time INR payments.
// Tables: Migration/create_salon_plan_payments.sql (+ create_salon_plan_prices.sql).
//
// Trust model: nothing the browser sends is believed. The amount is computed
// here from the price table, the payment is re-fetched from Razorpay and
// compared to the stored order (id, currency, amount, captured), and a row is
// only activated once, under a row lock. The browser's verify call and
// Razorpay's webhook both end up in settlePayment(), so whichever lands first
// activates and the other is a no-op.

const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, annual: 12 };

let razorpayClient: Razorpay | null = null;

function getRazorpay(): Razorpay {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    // 503 rather than crashing at boot: an environment without keys (e.g. a
    // QA box) should still run everything else.
    if (!key_id || !key_secret) {
        throw new AppError(503, "Online payments are not configured", "PAYMENTS_NOT_CONFIGURED");
    }
    return (razorpayClient ??= new Razorpay({ key_id, key_secret }));
}

function safeEqualHex(a: string, b: string): boolean {
    const ab = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Whole-paise integer maths: listed price -> GST -> total.
export function computeAmounts(listPrice: number) {
    const subtotalPaise = Math.round(listPrice * 100);
    const gstPaise = Math.round((subtotalPaise * GST_RATE_PERCENT) / 100);
    const totalPaise = subtotalPaise + gstPaise;
    return {
        subtotal: subtotalPaise / 100,
        gst_amount: gstPaise / 100,
        total_amount: totalPaise / 100,
        amount_paise: totalPaise,
    };
}

function addMonthsClamped(from: Date, months: number): Date {
    const d = new Date(from.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}

// DATE columns (salon_plan_customizations, invoices) are calendar dates in
// India — format in IST so a late-evening payment doesn't land on the wrong day.
function istDate(d: Date): string {
    return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function assertTier(tier: unknown): asserts tier is PlanTier {
    if (typeof tier !== "string" || !PLAN_TIER_ORDER.includes(tier as PlanTier)) {
        throw new AppError(400, `tier must be one of ${PLAN_TIER_ORDER.join(", ")}`, "VALIDATION_ERROR");
    }
}

function assertCycle(cycle: unknown): asserts cycle is BillingCycle {
    if (typeof cycle !== "string" || !BILLING_CYCLES.includes(cycle as BillingCycle)) {
        throw new AppError(400, `cycle must be one of ${BILLING_CYCLES.join(", ")}`, "VALIDATION_ERROR");
    }
}

// Listed price (before GST) this salon pays for tier+cycle. A salon-specific
// custom_price is a YEARLY price (that is how the Billing page has always
// shown it), so it only overrides the annual cycle of the tier it was set on.
async function resolveListPrice(salonId: string | null, tier: PlanTier, cycle: BillingCycle): Promise<number> {
    let price: number | null = null;
    try {
        const base = await planPricesRepository.findPrice(tier, cycle);
        price = base !== null ? Number(base) : null;
    } catch (err: any) {
        if (err?.code !== "42P01") throw err; // table missing = not priced yet
    }
    // A brand-new account has no salon yet, so no special price to look up.
    if (cycle === "annual" && salonId) {
        const custom = await salonCustomizationsRepository.findBySalonId(salonId);
        if (custom && custom.base_tier === tier && custom.custom_price !== null) {
            price = Number(custom.custom_price);
        }
    }
    if (price === null || !Number.isFinite(price) || price <= 0) {
        throw new AppError(400, "This plan is not available for the selected billing cycle", "PLAN_NOT_PRICED");
    }
    return price;
}

type PaymentRow = {
    id: string;
    // null = paid by a brand-new account whose salon does not exist yet; the
    // term is applied when onboarding creates it (applyPendingForNewSalon).
    salon_id: string | null;
    user_id: string | null;
    applied_at: string | null;
    payment_method: string | null;
    plan_tier: PlanTier;
    billing_cycle: BillingCycle;
    subtotal: string;
    gst_amount: string;
    total_amount: string;
    amount_paise: string;
    status: "created" | "paid" | "failed" | "refunded";
    razorpay_order_id: string;
    razorpay_payment_id: string | null;
    term_start: string | null;
    term_end: string | null;
    invoice_id: string | null;
};

// Writes the plan tier + term onto a salon, inside the caller's transaction:
// salon_plan_customizations (feature gating) and `subscriptions` (what the
// expiry wall / banner / poller read).
async function applyTermInTx(client: PoolClient, pay: PaymentRow, salonId: string): Promise<{ termStart: Date; termEnd: Date }> {
    const tier = pay.plan_tier;
    const cycle = pay.billing_cycle;
    const now = new Date();

    const { rows: custRows } = await client.query(
        `SELECT * FROM salon_plan_customizations WHERE salon_id = $1 FOR UPDATE`, [salonId]
    );
    const cust = custRows[0] as { base_tier: PlanTier; expiry_date: string | null } | undefined;
    const { rows: subRows } = await client.query(
        `SELECT id, current_period_end FROM subscriptions WHERE salon_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [salonId]
    );
    const sub = subRows[0] as { id: string; current_period_end: Date | null } | undefined;

    // Same tier & still running -> the new term is appended to the end of the
    // current one. A tier change (up or down) or a lapsed plan starts a fresh
    // term today and does not carry over the old one.
    const currentEnd = sub?.current_period_end ? new Date(sub.current_period_end) : null;
    const isExtension = !!cust && cust.base_tier === tier && !!currentEnd && currentEnd.getTime() > now.getTime();
    const termStart = isExtension ? (currentEnd as Date) : now;
    const termEnd = addMonthsClamped(termStart, CYCLE_MONTHS[cycle]);

    // salon_plan_customizations: tier + dates (feature gating).
    if (!cust) {
        await client.query(
            `INSERT INTO salon_plan_customizations (
                salon_id, base_tier, staff_limit, customer_limit, appointment_limit,
                branch_limit, storage_limit_gb, feature_overrides, start_date, expiry_date
             )
             SELECT $1, d.tier, d.default_staff_limit, d.default_customer_limit, d.default_appointment_limit,
                    d.default_branch_limit, d.default_storage_limit_gb, '{}'::jsonb, $3::date, $4::date
               FROM salon_plan_definitions d WHERE d.tier = $2`,
            [salonId, tier, istDate(termStart), istDate(termEnd)]
        );
    } else if (cust.base_tier === tier) {
        // Keep the salon's limits / feature overrides / special price.
        await client.query(
            isExtension
                ? `UPDATE salon_plan_customizations SET expiry_date = $2::date, updated_at = NOW() WHERE salon_id = $1`
                : `UPDATE salon_plan_customizations SET start_date = $3::date, expiry_date = $2::date, updated_at = NOW() WHERE salon_id = $1`,
            isExtension ? [salonId, istDate(termEnd)] : [salonId, istDate(termEnd), istDate(termStart)]
        );
    } else {
        // Tier changed: limits reset to the new tier's defaults; overrides and
        // the old tier's special price do not carry over.
        await client.query(
            `UPDATE salon_plan_customizations c SET
                base_tier = d.tier, custom_price = NULL,
                staff_limit = d.default_staff_limit, customer_limit = d.default_customer_limit,
                appointment_limit = d.default_appointment_limit, branch_limit = d.default_branch_limit,
                storage_limit_gb = d.default_storage_limit_gb, feature_overrides = '{}'::jsonb,
                start_date = $2::date, expiry_date = $3::date, updated_at = NOW()
               FROM salon_plan_definitions d
              WHERE d.tier = $4 AND c.salon_id = $1`,
            [salonId, istDate(termStart), istDate(termEnd), tier]
        );
    }

    // subscriptions: the row the expiry wall / banner / poller read.
    if (sub) {
        await client.query(
            `UPDATE subscriptions SET
                current_period_start = $2, current_period_end = $3, status = 'active',
                cancel_at_period_end = false, cancelled_at = NULL, updated_at = NOW()
              WHERE id = $1`,
            [sub.id, termStart.toISOString(), termEnd.toISOString()]
        );
    } else {
        // subscriptions.plan_id is NOT NULL (FK) — same fallback the
        // super-admin manual grant uses: any existing plan row.
        const { rows: planRows } = await client.query(
            `SELECT id FROM subscription_plans ORDER BY is_active DESC, price ASC LIMIT 1`
        );
        if (!planRows[0]) {
            throw new AppError(500, "No subscription plan row exists to attach this subscription to", "NO_PLANS_CONFIGURED");
        }
        await client.query(
            `INSERT INTO subscriptions (salon_id, plan_id, status, is_trial, current_period_start, current_period_end)
             VALUES ($1, $2, 'active', false, $3, $4)`,
            [salonId, planRows[0].id, termStart.toISOString(), termEnd.toISOString()]
        );
    }

    return { termStart, termEnd };
}

// After the money and access are safely committed: refresh the feature cache
// and record the invoice. A failure here must never undo or block activation.
async function finishActivation(settled: PaymentRow): Promise<void> {
    if (!settled.salon_id) return;
    invalidatePlanFeatureCache(settled.salon_id);
    try {
        const invoice = await salonPlanInvoicesRepository.create(
            {
                salon_id: settled.salon_id,
                plan_tier: settled.plan_tier,
                billing_cycle: settled.billing_cycle,
                period_start: istDate(new Date(settled.term_start as string)),
                period_end: istDate(new Date(settled.term_end as string)),
                payment_mode: settled.payment_method ? `Razorpay (${settled.payment_method})` : "Razorpay",
                amount: Number(settled.subtotal), // pre-GST; the repository adds GST
                apply_gst: true,
                status: "paid",
                issued_date: istDate(new Date()),
            },
            settled.user_id as string
        );
        await pool.query(`UPDATE salon_plan_payments SET invoice_id = $2, updated_at = NOW() WHERE id = $1`, [settled.id, invoice.id]);
        settled.invoice_id = invoice.id;
        salonPlansService._emailInvoiceToSalonOwner(invoice.id).catch((e: unknown) =>
            logger.error("planPayments: invoice email failed", { invoiceId: invoice.id, e })
        );
    } catch (err) {
        logger.error("planPayments: invoice creation failed after activation", { orderId: settled.razorpay_order_id, err });
    }
}

export const planPaymentsService = {

    // ── 1) Create an order for the logged-in salon owner ─────────────────────
    // salonId is null for a brand-new account paying straight after sign-up
    // (its salon is only created at the end of onboarding).
    async createCheckout(params: { salonId: string | null; userId: string; tier: unknown; cycle: unknown }) {
        const { salonId, userId } = params;
        assertTier(params.tier);
        assertCycle(params.cycle);
        const tier: PlanTier = params.tier;
        const cycle: BillingCycle = params.cycle;

        const def = await planDefinitionsRepository.findByTier(tier);
        if (!def) throw new AppError(404, "Plan not found", "NOT_FOUND");

        // renew / upgrade / downgrade are separately switchable per account —
        // a salon that does not exist yet has no such restrictions to apply.
        if (salonId) {
            const current = await salonCustomizationsRepository.findBySalonId(salonId);
            const currentTier: PlanTier = current?.base_tier ?? "basic";
            const rank = (t: PlanTier) => PLAN_TIER_ORDER.indexOf(t);
            const action =
                rank(tier) === rank(currentTier) ? "renew_subscription"
                : rank(tier) > rank(currentTier) ? "upgrade_subscription"
                : "downgrade_subscription";
            if (!(await isSubscriptionActionAllowed(salonId, action))) {
                throw new AppError(403, `Your salon does not have permission to perform this action (${action})`, "SUBSCRIPTION_ACTION_FORBIDDEN");
            }
        }

        const listPrice = await resolveListPrice(salonId, tier, cycle);
        const amounts = computeAmounts(listPrice);
        const razorpay = getRazorpay();

        let order: { id: string };
        try {
            order = await razorpay.orders.create({
                amount: amounts.amount_paise,
                currency: "INR",
                receipt: `plan_${crypto.randomBytes(8).toString("hex")}`,
                notes: { salon_id: salonId ?? "", user_id: userId, tier, cycle },
            });
        } catch (err: any) {
            logger.error("planPayments.createCheckout: Razorpay order failed", { status: err?.statusCode, error: err?.error ?? err?.message });
            if (err?.statusCode === 401) {
                throw new AppError(503, "Online payments are misconfigured", "PAYMENTS_NOT_CONFIGURED");
            }
            throw new AppError(502, "Could not start the payment. Please try again.", "PAYMENT_PROVIDER_ERROR");
        }

        await pool.query(
            `INSERT INTO salon_plan_payments (
                salon_id, user_id, plan_tier, billing_cycle,
                subtotal, gst_amount, total_amount, amount_paise, currency,
                status, razorpay_order_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'INR','created',$9)`,
            [salonId, userId, tier, cycle, amounts.subtotal, amounts.gst_amount, amounts.total_amount, amounts.amount_paise, order.id]
        );

        logger.info("planPayments.createCheckout", { salonId, tier, cycle, orderId: order.id, amountPaise: amounts.amount_paise });

        return {
            order_id: order.id,
            key_id: process.env.RAZORPAY_KEY_ID,
            currency: "INR",
            amount_paise: amounts.amount_paise,
            plan_tier: tier,
            plan_name: def.name,
            billing_cycle: cycle,
            subtotal: amounts.subtotal,
            gst_amount: amounts.gst_amount,
            total_amount: amounts.total_amount,
            gst_rate_percent: GST_RATE_PERCENT,
        };
    },

    // ── 2) Browser callback after Checkout succeeds ──────────────────────────
    async verifyPayment(params: { userId: string; orderId: unknown; paymentId: unknown; signature: unknown }) {
        const { userId, orderId, paymentId, signature } = params;
        if (typeof orderId !== "string" || typeof paymentId !== "string" || typeof signature !== "string"
            || !orderId || !paymentId || !signature) {
            throw new AppError(400, "razorpay_order_id, razorpay_payment_id and razorpay_signature are required", "VALIDATION_ERROR");
        }

        // Scoped to the caller: you cannot settle someone else's order. (By
        // user, not salon — a new account paying before onboarding has no salon.)
        const { rows } = await pool.query<PaymentRow>(
            `SELECT * FROM salon_plan_payments WHERE razorpay_order_id = $1 AND user_id = $2`,
            [orderId, userId]
        );
        if (!rows[0]) throw new AppError(404, "Payment order not found", "NOT_FOUND");

        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!secret) throw new AppError(503, "Online payments are not configured", "PAYMENTS_NOT_CONFIGURED");
        const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
        if (!safeEqualHex(expected, signature)) {
            throw new AppError(400, "Invalid payment signature", "INVALID_SIGNATURE");
        }

        const settled = await this.settlePayment(orderId, paymentId);
        return {
            status: "paid" as const,
            plan_tier: settled.plan_tier,
            billing_cycle: settled.billing_cycle,
            term_start: settled.term_start,
            term_end: settled.term_end,
        };
    },

    // ── 3) The one place a payment becomes an activated plan ─────────────────
    // Idempotent and safe to call concurrently (verify + webhook + retries).
    async settlePayment(orderId: string, paymentId: string): Promise<PaymentRow> {
        const { rows: pre } = await pool.query<PaymentRow>(
            `SELECT * FROM salon_plan_payments WHERE razorpay_order_id = $1`, [orderId]
        );
        const row = pre[0];
        if (!row) throw new AppError(404, "Payment order not found", "NOT_FOUND");
        // 'refunded' is terminal too: a replayed capture event must not re-grant access.
        if (row.status === "paid" || row.status === "refunded") return row;

        // Ask Razorpay what really happened — the signature only proves the
        // ids were issued together, not that this order was paid in full.
        const razorpay = getRazorpay();
        let rzp: any;
        try {
            rzp = await razorpay.payments.fetch(paymentId);
        } catch (err: any) {
            logger.error("planPayments.settle: payments.fetch failed", { orderId, paymentId, error: err?.error ?? err?.message });
            throw new AppError(502, "Could not confirm the payment with Razorpay. If money was deducted it will be applied automatically.", "PAYMENT_PROVIDER_ERROR");
        }

        if (rzp.order_id !== orderId || rzp.currency !== "INR" || Number(rzp.amount) !== Number(row.amount_paise)) {
            logger.error("planPayments.settle: payment does not match order", {
                orderId, paymentId, rzpOrder: rzp.order_id, rzpAmount: rzp.amount, rzpCurrency: rzp.currency, expectedPaise: row.amount_paise,
            });
            throw new AppError(400, "Payment does not match this order", "PAYMENT_MISMATCH");
        }

        if (rzp.status === "authorized") {
            // Account is on manual capture — capture the exact stored amount.
            try {
                rzp = await razorpay.payments.capture(paymentId, Number(row.amount_paise), "INR");
            } catch (err: any) {
                logger.error("planPayments.settle: capture failed", { orderId, paymentId, error: err?.error ?? err?.message });
                throw new AppError(502, "Could not capture the payment", "PAYMENT_PROVIDER_ERROR");
            }
        }
        if (rzp.status !== "captured") {
            throw new AppError(409, `Payment is not completed yet (status: ${rzp.status})`, "PAYMENT_NOT_CAPTURED");
        }

        // ── Activate under a row lock; the claim and the activation commit together.
        const client = await pool.connect();
        let settled: PaymentRow;
        let activatedNow = false;
        try {
            await client.query("BEGIN");
            const { rows: locked } = await client.query<PaymentRow>(
                `SELECT * FROM salon_plan_payments WHERE razorpay_order_id = $1 FOR UPDATE`, [orderId]
            );
            const pay = locked[0];
            if (!pay) throw new AppError(404, "Payment order not found", "NOT_FOUND");
            if (pay.status === "paid" || pay.status === "refunded") {
                await client.query("COMMIT");
                return pay;
            }

            // A brand-new account paying before onboarding has no salon yet:
            // keep the money safely recorded as paid-but-unapplied. The term is
            // applied when onboarding creates the salon (applyPendingForNewSalon).
            if (!pay.salon_id) {
                const { rows: held } = await client.query<PaymentRow>(
                    `UPDATE salon_plan_payments SET
                        status = 'paid', razorpay_payment_id = $2, payment_method = $3,
                        paid_at = NOW(), failure_reason = NULL, updated_at = NOW()
                      WHERE id = $1 RETURNING *`,
                    [pay.id, paymentId, rzp.method ?? null]
                );
                await client.query("COMMIT");
                logger.info("planPayments.settle: paid, waiting for salon to be created", { userId: pay.user_id, orderId, paymentId });
                return held[0];
            }

            const { termStart, termEnd } = await applyTermInTx(client, pay, pay.salon_id);

            const { rows: done } = await client.query<PaymentRow>(
                `UPDATE salon_plan_payments SET
                    status = 'paid', razorpay_payment_id = $2, payment_method = $3,
                    term_start = $4, term_end = $5, paid_at = NOW(), applied_at = NOW(),
                    failure_reason = NULL, updated_at = NOW()
                  WHERE id = $1 RETURNING *`,
                [pay.id, paymentId, rzp.method ?? null, termStart.toISOString(), termEnd.toISOString()]
            );
            await client.query("COMMIT");
            settled = done[0];
            activatedNow = true;
        } catch (err) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw err;
        } finally {
            client.release();
        }

        if (!activatedNow) return settled;

        logger.info("planPayments.settle: activated", {
            salonId: settled.salon_id, tier: settled.plan_tier, cycle: settled.billing_cycle,
            orderId, paymentId, termEnd: settled.term_end,
        });
        await finishActivation(settled);
        return settled;
    },

    // ── 3b) A salon was just created: apply any plan its owner already paid for ─
    // Called from salonsService.create (end of onboarding). New accounts go
    // from "Create account" straight to the subscription page, so the payment
    // can pre-date the salon. Each waiting payment is applied in order, so two
    // payments for the same tier simply stack. Failures are logged loudly and
    // never block onboarding — the payment stays 'paid' + unapplied and can be
    // re-applied (this function is safe to call again).
    async applyPendingForNewSalon(userId: string, salonId: string): Promise<number> {
        let applied = 0;
        let rows: { id: string }[];
        try {
            ({ rows } = await pool.query<{ id: string }>(
                `SELECT id FROM salon_plan_payments
                  WHERE user_id = $1 AND salon_id IS NULL AND status = 'paid' AND applied_at IS NULL
                  ORDER BY paid_at ASC`,
                [userId]
            ));
        } catch (err: any) {
            // Payments migrations not run on this environment: nothing to apply.
            if (err?.code === "42P01" || err?.code === "42703") return 0;
            throw err;
        }
        for (const { id } of rows) {
            const client = await pool.connect();
            let settled: PaymentRow | null = null;
            try {
                await client.query("BEGIN");
                const { rows: locked } = await client.query<PaymentRow>(
                    `SELECT * FROM salon_plan_payments WHERE id = $1 FOR UPDATE`, [id]
                );
                const pay = locked[0];
                // Someone else applied it meanwhile, or it was refunded.
                if (!pay || pay.salon_id || pay.applied_at || pay.status !== "paid") {
                    await client.query("COMMIT");
                    continue;
                }
                const { termStart, termEnd } = await applyTermInTx(client, pay, salonId);
                const { rows: done } = await client.query<PaymentRow>(
                    `UPDATE salon_plan_payments SET
                        salon_id = $2, term_start = $3, term_end = $4, applied_at = NOW(), updated_at = NOW()
                      WHERE id = $1 RETURNING *`,
                    [pay.id, salonId, termStart.toISOString(), termEnd.toISOString()]
                );
                await client.query("COMMIT");
                settled = done[0];
            } catch (err) {
                await client.query("ROLLBACK").catch(() => undefined);
                logger.error("planPayments: could not apply a paid plan to the new salon — payment is recorded, apply manually", {
                    userId, salonId, paymentRowId: id, err,
                });
                continue;
            } finally {
                client.release();
            }
            if (settled) {
                logger.info("planPayments: applied pre-paid plan to new salon", {
                    userId, salonId, tier: settled.plan_tier, cycle: settled.billing_cycle, termEnd: settled.term_end,
                });
                await finishActivation(settled);
                applied++;
            }
        }
        return applied;
    },

    // ── 4) Razorpay webhook (raw body) ───────────────────────────────────────
    verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) throw new AppError(503, "Webhook secret is not configured", "PAYMENTS_NOT_CONFIGURED");
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
        return safeEqualHex(expected, signature);
    },

    async handleWebhook(eventId: string, event: any): Promise<void> {
        const type: string = event?.event ?? "";

        // De-dupe: Razorpay retries, and the same event can arrive twice.
        const { rowCount } = await pool.query(
            `INSERT INTO razorpay_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING`,
            [eventId, type]
        );
        if (!rowCount) return;

        try {
            const payment = event?.payload?.payment?.entity;
            switch (type) {
                case "payment.captured":
                case "order.paid": {
                    const orderId: string | undefined = payment?.order_id ?? event?.payload?.order?.entity?.id;
                    const paymentId: string | undefined = payment?.id;
                    if (!orderId || !paymentId) break;
                    const { rows } = await pool.query(`SELECT 1 FROM salon_plan_payments WHERE razorpay_order_id = $1`, [orderId]);
                    if (!rows[0]) break; // not one of ours (same account may serve other products)
                    await this.settlePayment(orderId, paymentId);
                    break;
                }
                case "payment.failed": {
                    if (!payment?.order_id) break;
                    // Never downgrade a paid row; only mark attempts still open.
                    await pool.query(
                        `UPDATE salon_plan_payments SET status = 'failed', failure_reason = $2, updated_at = NOW()
                          WHERE razorpay_order_id = $1 AND status = 'created'`,
                        [payment.order_id, payment.error_description ?? payment.error_reason ?? "Payment failed"]
                    );
                    break;
                }
                case "refund.processed": {
                    const paymentId: string | undefined = event?.payload?.refund?.entity?.payment_id ?? payment?.id;
                    if (!paymentId) break;
                    // Recorded only — revoking access is a deliberate manual
                    // decision (Super Admin > Remove Subscription).
                    const { rowCount: n } = await pool.query(
                        `UPDATE salon_plan_payments SET status = 'refunded', updated_at = NOW()
                          WHERE razorpay_payment_id = $1 AND status = 'paid'`,
                        [paymentId]
                    );
                    if (n) logger.warn("planPayments: refund processed — access NOT revoked automatically", { paymentId });
                    break;
                }
                default:
                    break;
            }
        } catch (err) {
            // Let Razorpay's retry reprocess it: forget we saw this event.
            await pool.query(`DELETE FROM razorpay_webhook_events WHERE event_id = $1`, [eventId]).catch(() => undefined);
            throw err;
        }
    },
};
