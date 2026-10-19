import crypto from "crypto";
import type { PoolClient } from "pg";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpay } from "../../config/razorpay";

const TIERS = ["basic", "advance", "growth"] as const;
const CYCLES = ["monthly", "quarterly", "yearly"] as const;
type Tier = (typeof TIERS)[number];
type Cycle = (typeof CYCLES)[number];

// Razorpay needs a total number of billing cycles up front. Ten years of each cycle; the owner can cancel any time.
const TOTAL_COUNT: Record<Cycle, number> = { monthly: 120, quarterly: 40, yearly: 10 };

const isTier = (v: unknown): v is Tier => (TIERS as readonly string[]).includes(v as string);
const isCycle = (v: unknown): v is Cycle => (CYCLES as readonly string[]).includes(v as string);
const fromUnix = (n: unknown) => (typeof n === "number" && n > 0 ? new Date(n * 1000) : null);

export const subscriptionCheckoutService = {
    // Creates a Razorpay subscription for the chosen plan and returns Razorpay's hosted payment page (short_url).
    // Our own row is created as 'created'; it only becomes 'active' when the webhook confirms payment.
    // `salonId` is null when the owner pays right after registering, before onboarding has created the salon: the
    // subscription then belongs to the user and is attached to the salon by attachPendingToSalon().
    async createCheckout(salonId: string | null, userId: string, tier: unknown, cycle: unknown) {
        if (!isTier(tier) || !isCycle(cycle)) {
            throw new AppError(400, "tier must be basic, advance or growth and cycle monthly, quarterly or yearly", "VALIDATION_ERROR");
        }
        const slug = `salonox-${tier}-${cycle}`;
        const { rows } = await pool.query(
            `SELECT id, name, price, razorpay_plan_id FROM subscription_plans WHERE slug = $1 AND is_active = TRUE`,
            [slug]
        );
        const plan = rows[0];
        if (!plan) throw new AppError(404, "This plan isn't available at that billing cycle", "NOT_FOUND");
        if (!plan.razorpay_plan_id) {
            throw new AppError(409, "This plan isn't connected to Razorpay yet. Please contact support.", "PLAN_NOT_SYNCED");
        }

        let created: any;
        try {
            created = await getRazorpay().subscriptions.create({
                plan_id: plan.razorpay_plan_id,
                total_count: TOTAL_COUNT[cycle],
                quantity: 1,
                customer_notify: 1,
                notes: { salon_id: salonId ?? "", user_id: userId, plan_slug: slug },
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            const detail = err?.error?.description ?? err?.message ?? "unknown error";
            logger.error("Razorpay subscription create failed", { salonId, slug, detail });
            throw new AppError(502, `Razorpay could not start the payment: ${detail}`, "RAZORPAY_ERROR");
        }

        await pool.query(
            `INSERT INTO subscriptions (salon_id, user_id, plan_id, status, is_trial, cancel_at_period_end, razorpay_subscription_id)
             VALUES ($1, $2, $3, 'created', FALSE, FALSE, $4)`,
            [salonId, userId, plan.id, created.id]
        );
        return { short_url: created.short_url as string, razorpay_subscription_id: created.id as string };
    },

    // Onboarding just created the salon: hand it every subscription the owner started before it existed (paid or
    // still pending). Also closes any other live subscription of that salon, so the paid one is the one that counts.
    async attachPendingToSalon(userId: string, salonId: string): Promise<number> {
        const { rows } = await pool.query(
            `UPDATE subscriptions SET salon_id = $2, updated_at = NOW()
             WHERE user_id = $1 AND salon_id IS NULL
             RETURNING id, status`,
            [userId, salonId]
        );
        if (rows.some((r) => r.status === "active")) {
            await pool.query(
                `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                 WHERE salon_id = $1 AND status IN ('active', 'trialing')
                   AND id NOT IN (SELECT id FROM subscriptions WHERE user_id = $2 AND status = 'active')`,
                [salonId, userId]
            );
        }
        if (rows.length) logger.info("Attached pre-onboarding subscriptions to salon", { userId, salonId, count: rows.length });
        return rows.length;
    },

    // Has this user paid (active, unexpired subscription started through checkout)? The plan page polls this while
    // the owner pays in the Razorpay tab.
    async paymentStatus(userId: string) {
        const { rows } = await pool.query(
            `SELECT s.current_period_end, sp.name AS plan_name
             FROM subscriptions s LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
             WHERE s.user_id = $1 AND s.status = 'active'
               AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
             ORDER BY s.created_at DESC LIMIT 1`,
            [userId]
        );
        return rows[0]
            ? { paid: true, plan_name: rows[0].plan_name as string | null, ends_at: rows[0].current_period_end as string | null }
            : { paid: false, plan_name: null, ends_at: null };
    },

    // Razorpay signs the exact raw body with the webhook secret (HMAC-SHA256, hex).
    verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret || !rawBody || !signature) return false;
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(signature);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    },

    // Applies one Razorpay event. Idempotent: Razorpay retries and may deliver events out of order, so every
    // write is either a state set or guarded (payments are de-duplicated by Razorpay payment id).
    async processEvent(client: PoolClient, event: any): Promise<string> {
        const type: string = event?.event ?? "";
        const sub = event?.payload?.subscription?.entity;
        if (!sub?.id) return `ignored (${type || "no subscription"})`;

        const { rows } = await client.query(
            `SELECT id, salon_id FROM subscriptions WHERE razorpay_subscription_id = $1 FOR UPDATE`,
            [sub.id]
        );
        const row = rows[0];
        if (!row) return `ignored (unknown subscription ${sub.id})`;

        const start = fromUnix(sub.current_start);
        const end = fromUnix(sub.current_end);

        switch (type) {
            case "subscription.authenticated":
                await client.query(
                    `UPDATE subscriptions SET status = 'authenticated', updated_at = NOW() WHERE id = $1 AND status = 'created'`,
                    [row.id]
                );
                return "authenticated";

            case "subscription.activated":
            case "subscription.charged": {
                // The new period is the one that counts: close any other live subscription for this salon so an
                // older, longer row can't keep overriding it.
                if (row.salon_id) {
                    await client.query(
                        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                         WHERE salon_id = $1 AND id <> $2 AND status IN ('active', 'trialing')`,
                        [row.salon_id, row.id]
                    );
                }
                await client.query(
                    `UPDATE subscriptions
                     SET status = 'active', is_trial = FALSE, cancel_at_period_end = FALSE, cancelled_at = NULL,
                         current_period_start = COALESCE($2, current_period_start),
                         current_period_end = COALESCE($3, current_period_end),
                         updated_at = NOW()
                     WHERE id = $1`,
                    [row.id, start, end]
                );
                if (type === "subscription.charged") {
                    const pay = event?.payload?.payment?.entity;
                    if (pay?.id) {
                        const dup = await client.query(`SELECT 1 FROM subscription_payments WHERE transaction_id = $1`, [pay.id]);
                        if (dup.rowCount === 0) {
                            await client.query(
                                `INSERT INTO subscription_payments
                                    (subscription_id, amount, payment_status, payment_method, transaction_id,
                                     billing_period_start, billing_period_end, paid_at)
                                 VALUES ($1, $2, 'paid', $3, $4, $5, $6, $7)`,
                                [row.id, Number(pay.amount) / 100, pay.method ?? null, pay.id, start, end, fromUnix(pay.created_at) ?? new Date()]
                            );
                        }
                    }
                }
                return type === "subscription.charged" ? "charged" : "activated";
            }

            case "subscription.cancelled":
                await client.query(
                    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
                    [row.id]
                );
                return "cancelled";

            case "subscription.completed":
                await client.query(`UPDATE subscriptions SET status = 'completed', updated_at = NOW() WHERE id = $1`, [row.id]);
                return "completed";

            case "subscription.halted":
            case "subscription.paused":
                await client.query(`UPDATE subscriptions SET status = 'paused', updated_at = NOW() WHERE id = $1`, [row.id]);
                return "paused";

            default:
                return `ignored (${type})`;
        }
    },

    async handleWebhook(event: any): Promise<string> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await this.processEvent(client, event);
            await client.query("COMMIT");
            return result;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
