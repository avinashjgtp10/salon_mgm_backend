import crypto from "crypto";
import type { PoolClient } from "pg";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpay, getRazorpayCredentials } from "../../config/razorpay";
import { subscriptionInvoicesService } from "../subscription-invoices/subscription-invoices.service";
import { subscriptionUpgradeService } from "../subscription-upgrade/subscription-upgrade.service";
import { salonModulesService } from "../salon-modules/salon-modules.service";
import { tierOfPlan } from "../subscription-billing/plan-tier";
import { subscriptionPricingService } from "../subscription-pricing/pricing.service";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";
import { resolveRazorpayPlan } from "../subscription-pricing/razorpay-plans";
import { checkConsentToken, issueConsentToken, type ConsentBinding } from "../subscription-pricing/currency-consent";
import { currencyForCountry } from "../subscription-pricing/country-currency";
import { exponentOf, markCurrencyRefused } from "../subscription-pricing/pricing.service";
import { subscriptionPlanChangeService } from "./subscription-plan-change.service";

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
    // The customer's own currency cannot be charged (not enabled for subscriptions, or no live rate). Nothing is charged and nothing is
    // created: the answer is a 409 CURRENCY_NOT_ENABLED that explains why and lists what the customer can do. INR billing is one of those
    // options, and it is only ever done after the customer confirms it: the offer carries a signed consent token for the exact INR amount.
    consentRequired(binding: ConsentBinding, quote: Awaited<ReturnType<typeof subscriptionPricingService.quote>>["quote"], status: string): AppError {
        const c = quote.charge;
        const inr = `₹${c.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return new AppError(
            409,
            `Subscriptions in ${binding.requestedCurrency} are not available yet. You can continue and be billed ${inr} in INR per ${binding.cycle === "yearly" ? "year" : binding.cycle === "quarterly" ? "quarter" : "month"} (GST included), choose a different country, or contact support.`,
            "CURRENCY_NOT_ENABLED",
            {
                requested_currency: binding.requestedCurrency,
                country: binding.country,
                reason: c.reason,
                consent_status: status,   // missing | expired | invalid | mismatch (an earlier confirmation no longer matches the price)
                display: quote.display,
                alternatives: [
                    {
                        type: "continue_in_inr", label: `Continue and be billed in INR (${inr})`, currency: "INR",
                        subtotal: c.subtotal, tax: c.tax, tax_percent: c.tax_percent, total: c.total, recurring_amount: c.recurring_amount,
                        consent_token: issueConsentToken(binding),
                    },
                    { type: "change_country", label: "Choose a different country" },
                    { type: "contact_support", label: `Contact support about billing in ${binding.requestedCurrency}` },
                ],
            },
        );
    },

    // Creates a Razorpay subscription for the chosen plan and returns Razorpay's hosted payment page (short_url).
    // Our own row is created as 'created'; it only becomes 'active' when the webhook confirms payment.
    // `salonId` is null when the owner pays right after registering, before onboarding has created the salon: the
    // subscription then belongs to the user and is attached to the salon by attachPendingToSalon().
    // The customer's country for pricing: the one sent with the request (the visitor's pick), else the one saved on their account,
    // else their salon's. Never an amount: the price is always worked out here, on the server.
    async resolveCountry(userId: string, salonId: string | null, provided: unknown): Promise<string> {
        const direct = currencyForCountry(typeof provided === "string" ? provided : null);
        if (direct) return direct.country;
        const { rows } = await pool.query(
            `SELECT u.country AS user_country, s.country AS salon_country
             FROM users u LEFT JOIN salons s ON s.id = $2 WHERE u.id = $1`,
            [userId, salonId]
        );
        return currencyForCountry(rows[0]?.user_country)?.country ?? currencyForCountry(rows[0]?.salon_country)?.country ?? "IN";
    },

    // Creates a Razorpay subscription for the chosen plan and returns Razorpay's hosted payment page (short_url).
    // Our own row is created as 'created'; it only becomes 'active' when the webhook confirms payment.
    // `salonId` is null when the owner pays right after registering, before onboarding has created the salon: the
    // subscription then belongs to the user and is attached to the salon by attachPendingToSalon().
    //
    // The amount and currency come from the server's own price calculation (subscription-pricing) for the customer's
    // country, never from the browser. A non-INR charge happens only for currencies enabled on the Razorpay account; any other
    // country is billed in INR, and the returned `charge` says exactly what that is.
    async createCheckout(salonId: string | null, userId: string, tier: unknown, cycle: unknown, country?: unknown, consentToken?: unknown) {
        if (!isTier(tier) || !isCycle(cycle)) {
            throw new AppError(400, "tier must be basic, advance or growth and cycle monthly, quarterly or yearly", "VALIDATION_ERROR");
        }
        const customerCountry = await this.resolveCountry(userId, salonId, country);
        let quoted = await subscriptionPricingService.quote(tier, cycle, customerCountry);

        // The customer's own currency can't be charged: never fall back to INR on our own. Without a valid consent token for exactly this
        // offer the answer is a 409 with the alternatives; with one, the confirmation is recorded with the subscription below.
        // If Razorpay itself refuses the currency when the plan is created, that currency is remembered as unavailable and the customer is
        // offered INR (again with explicit consent) instead of hitting an error.
        let consent: { requested: string; amount: number } | null = null;
        let razorpayPlanId = "";
        for (let attempt = 0; attempt < 2; attempt++) {
            const { base, quote } = quoted;
            const charge = quote.charge;
            consent = null;
            if (charge.fallback) {
                const requested = currencyForCountry(quote.country)?.currency ?? quote.display.currency;
                const binding: ConsentBinding = { userId, tier, cycle, country: quote.country, requestedCurrency: requested, amount: charge.total };
                const check = checkConsentToken(consentToken, binding);
                if (!check.ok) throw this.consentRequired(binding, quote, check.reason);
                consent = { requested, amount: charge.total };
                logger.info("Customer confirmed INR billing", { userId, slug: base.slug, requested, amount: charge.total });
            }
            try {
                // INR plans carry price + GST; a non-INR plan carries the converted amount (no tax added). Either way it is the plan
                // registered for THIS Razorpay account, never one that belongs to another account or mode.
                razorpayPlanId = await resolveRazorpayPlan(base, charge.currency, charge.currency === "INR" ? charge.total : charge.subtotal, charge.fx_rate);
                break;
            } catch (err: any) {
                if (attempt === 0 && err?.code === "CURRENCY_NOT_SUPPORTED" && charge.currency !== "INR") {
                    markCurrencyRefused(charge.currency);
                    quoted = await subscriptionPricingService.quote(tier, cycle, customerCountry);
                    continue;
                }
                throw err;
            }
        }
        const { base, quote } = quoted;
        const charge = quote.charge;
        const slug = base.slug;

        let created: any;
        try {
            created = await (await getRazorpay()).subscriptions.create({
                plan_id: razorpayPlanId,
                total_count: TOTAL_COUNT[cycle],
                quantity: 1,
                customer_notify: 1,
                notes: { salon_id: salonId ?? "", user_id: userId, plan_slug: slug, country: quote.country, charge_currency: charge.currency },
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            const detail = err?.error?.description ?? err?.message ?? "unknown error";
            logger.error("Razorpay subscription create failed", { salonId, slug, detail, currency: charge.currency });
            throw new AppError(502, `Razorpay could not start the payment: ${detail}`, "RAZORPAY_ERROR");
        }

        // What was quoted and charged is stored with the subscription, so it stays the original purchase price and currency
        // whatever the exchange rate does later.
        if (await billingSchemaReady()) {
            await pool.query(
                `INSERT INTO subscriptions
                    (salon_id, user_id, plan_id, status, is_trial, cancel_at_period_end, razorpay_subscription_id,
                     country_code, pricing_currency, charged_currency, charged_amount, charged_tax, base_price_inr, display_amount, fx_rate,
                     pricing_razorpay_plan_id, currency_consent_at, currency_consent_requested, currency_consent_amount)
                 VALUES ($1, $2, $3, 'created', FALSE, FALSE, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                [salonId, userId, base.id, created.id, quote.country, quote.display.currency, charge.currency, charge.total, charge.tax,
                 base.price, quote.display.total, charge.fx_rate, razorpayPlanId,
                 consent ? new Date() : null, consent?.requested ?? null, consent?.amount ?? null]
            );
        } else {
            await pool.query(
                `INSERT INTO subscriptions (salon_id, user_id, plan_id, status, is_trial, cancel_at_period_end, razorpay_subscription_id)
                 VALUES ($1, $2, $3, 'created', FALSE, FALSE, $4)`,
                [salonId, userId, base.id, created.id]
            );
        }
        return {
            short_url: created.short_url as string,
            razorpay_subscription_id: created.id as string,
            country: quote.country,
            display: quote.display,
            charge,
            consent_recorded: consent !== null,
        };
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
        if (rows.length) {
            logger.info("Attached pre-onboarding subscriptions to salon", { userId, salonId, count: rows.length });
            // Payments made before the salon existed couldn't be billed then; they can now.
            await subscriptionInvoicesService.billAllUnbilledForSalon(salonId).catch((err) =>
                logger.error("Billing attached payments failed", { salonId, error: err?.message })
            );
        }
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
    async verifySignature(rawBody: Buffer | undefined, signature: string | undefined): Promise<boolean> {
        const secret = (await getRazorpayCredentials()).webhookSecret;
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
            `SELECT id, salon_id, status FROM subscriptions WHERE razorpay_subscription_id = $1 FOR UPDATE`,
            [sub.id]
        );
        const row = rows[0];
        if (!row) return `ignored (unknown subscription ${sub.id})`;
        // Replaced by a plan upgrade: late events from the old Razorpay subscription must not bring it back to life.
        if (row.status === "upgraded") return `ignored (${type}: superseded by an upgrade)`;

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
                            // The payment's own currency and amount, as Razorpay reports them (never assumed to be INR).
                            const payCurrency = typeof pay.currency === "string" && /^[A-Za-z]{3}$/.test(pay.currency) ? pay.currency.toUpperCase() : "INR";
                            const payAmount = Number(pay.amount) / 10 ** exponentOf(payCurrency);
                            const hasCurrency = await billingSchemaReady();
                            const inserted = hasCurrency
                                ? await client.query(
                                    `INSERT INTO subscription_payments
                                        (subscription_id, amount, payment_status, payment_method, transaction_id,
                                         billing_period_start, billing_period_end, paid_at, currency)
                                     VALUES ($1, $2, 'paid', $3, $4, $5, $6, $7, $8)
                                     RETURNING id`,
                                    [row.id, payAmount, pay.method ?? null, pay.id, start, end, fromUnix(pay.created_at) ?? new Date(), payCurrency]
                                )
                                : await client.query(
                                    `INSERT INTO subscription_payments
                                        (subscription_id, amount, payment_status, payment_method, transaction_id,
                                         billing_period_start, billing_period_end, paid_at)
                                     VALUES ($1, $2, 'paid', $3, $4, $5, $6, $7)
                                     RETURNING id`,
                                    [row.id, payAmount, pay.method ?? null, pay.id, start, end, fromUnix(pay.created_at) ?? new Date()]
                                );
                            // The tax invoice for this payment (skipped quietly if the salon doesn't exist yet: it is
                            // billed when onboarding attaches the subscription).
                            await subscriptionInvoicesService.generateForPaymentTx(client, inserted.rows[0].id);
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

    async applyPlanFeatures(razorpaySubscriptionId: string | undefined) {
        if (!razorpaySubscriptionId) return;
        const { rows } = await pool.query(
            `SELECT s.salon_id, sp.tier, sp.name, sp.slug, sl.owner_id
             FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id LEFT JOIN salons sl ON sl.id = s.salon_id
             WHERE s.razorpay_subscription_id = $1`, [razorpaySubscriptionId]);
        const r = rows[0];
        const tier = r ? tierOfPlan({ tier: r.tier, name: r.name, slug: r.slug }) : null;
        if (r?.salon_id && r.owner_id && tier) await salonModulesService.applyPlanTier(r.salon_id, tier, r.owner_id);
    },

    async handleWebhook(event: any): Promise<string> {
        // Order / payment events that belong to a plan upgrade (no subscription attached) go to the upgrade service.
        if (!event?.payload?.subscription?.entity?.id && /^(order|payment)./.test(event?.event ?? "")) {
            return subscriptionUpgradeService.handleGatewayEvent(event);
        }
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const result = await this.processEvent(client, event);
            await client.query("COMMIT");
            // After the commit, mail the invoice PDF to the owner (best effort, never blocks Razorpay's 200).
            const paymentId = event?.payload?.payment?.entity?.id;
            if (result === "charged" && paymentId) subscriptionInvoicesService.emailForTransaction(paymentId).catch((err) => logger.warn("Subscription invoice email failed", { paymentId, error: err?.message }));
            // A replacement subscription was just authorised: the one it replaces now stops renewing at the end of its cycle.
            // If this fails the webhook fails too, so Razorpay delivers it again (the event itself is already stored and handling it again is idempotent).
            if (result === "authenticated") await subscriptionPlanChangeService.onAuthenticated(event?.payload?.subscription?.entity?.id);
            // First activation of a plan: the salon gets that plan's features (not on every renewal, so an admin's later
            // manual customisation isn't undone each month).
            if (result === "activated") await this.applyPlanFeatures(event?.payload?.subscription?.entity?.id).catch((e: any) => logger.error("Applying plan features failed", { error: e?.message }));
            return result;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
