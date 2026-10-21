import pool from "../../config/database";
import { GST_PERCENT } from "../plan-pricing/plan-pricing.service";
import { CYCLES, TIERS, dbDate, normalizeCycle, tierOfPlan, type Cycle, type Tier } from "./plan-tier";
import { daysRemaining, deriveSubscriptionState, isLiveState, type SubscriptionState } from "./subscription-status";
import { relationOf, type PlanRelation } from "../subscription-upgrade/upgrade-quote";
import { loadUpgradePolicy } from "../subscription-upgrade/upgrade-policy";

// What the Billing & Plans page shows. Everything is read from the salon's own subscription rows and from VERIFIED payment
// and invoice records, never from the default plan list or from "the newest plan created".

type Db = Pick<import("pg").Pool, "query">;

export type PlanAction = PlanRelation | "new";

export interface SubRow {
    id: string;
    status: string;
    is_trial: boolean;
    current_period_start: Date | null;
    current_period_end: Date | null;
    trial_end: Date | null;
    cancel_at_period_end: boolean;
    razorpay_subscription_id: string | null;
    created_at: Date;
    plan_id: string | null;
    plan_name: string | null;
    plan_slug: string | null;
    plan_tier: string | null;
    plan_cycle: string | null;
    plan_price: string | null;
}

export const subscriptionEnd = (s: Pick<SubRow, "status" | "trial_end" | "current_period_end">): Date | null =>
    (s.status === "trialing" ? s.trial_end ?? s.current_period_end : s.current_period_end ?? s.trial_end) ?? null;

export async function loadSalonSubscriptions(db: Db, salonId: string): Promise<SubRow[]> {
    const { rows } = await db.query(
        `SELECT s.id, s.status, s.is_trial, s.current_period_start, s.current_period_end, s.trial_end, s.cancel_at_period_end,
                s.razorpay_subscription_id, s.created_at,
                sp.id AS plan_id, sp.name AS plan_name, sp.slug AS plan_slug, sp.tier AS plan_tier,
                sp.billing_cycle AS plan_cycle, sp.price AS plan_price
         FROM subscriptions s
         LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.salon_id = $1
         ORDER BY s.created_at DESC`,
        [salonId]
    );
    // The pool hands timestamps back as zone-less strings; read them as UTC Dates once, here.
    return rows.map((r) => ({
        ...r,
        current_period_start: dbDate(r.current_period_start),
        current_period_end: dbDate(r.current_period_end),
        trial_end: dbDate(r.trial_end),
        created_at: dbDate(r.created_at) ?? new Date(0),
    }));
}

/**
 * The salon's CURRENT subscription, by the existing business rule: a salon is covered if ANY of its rows is active or trialing
 * and not past its end date. If several are, the one that runs longest wins (ties: the newest). If none is live, the most
 * recent row that actually belonged to the salon (not an unfinished checkout) is shown, so an expired plan reads "Expired";
 * if all that exists is an unfinished checkout, that is what the salon sees ("Pending payment").
 */
export function pickCurrentSubscription(rows: SubRow[], now: Date = new Date()): SubRow | null {
    const stateOf = (r: SubRow) => deriveSubscriptionState({ status: r.status, periodEnd: subscriptionEnd(r), now, salonActive: true });
    const live = rows.filter((r) => isLiveState(stateOf(r)));
    if (live.length > 0) {
        return [...live].sort((a, b) => {
            const ea = subscriptionEnd(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const eb = subscriptionEnd(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
            return eb - ea || b.created_at.getTime() - a.created_at.getTime();
        })[0];
    }
    const real = rows.find((r) => r.status !== "created" && r.status !== "authenticated" && r.status !== "upgraded");
    return real ?? rows.find((r) => r.status === "created" || r.status === "authenticated") ?? null;
}

export interface PaidInfo {
    state: "paid" | "not_recorded";
    subtotal: number | null;
    gst_percent: number | null;
    gst_amount: number | null;
    total: number | null;
    paid_at: string | null;
    reference: string | null;
    mode: string | null;
    invoice_id: string | null;
    source: "invoice" | "payment" | null;
}

const NOT_RECORDED: PaidInfo = {
    state: "not_recorded", subtotal: null, gst_percent: null, gst_amount: null, total: null,
    paid_at: null, reference: null, mode: null, invoice_id: null, source: null,
};

/**
 * What the salon actually paid for a subscription. Order of trust: the issued tax invoice (a manual one is matched by the
 * salon and an overlapping period, since it has no subscription link), then a verified payment row. Neither = nothing recorded
 * (e.g. an admin assigned the plan without recording a payment): that is shown as such, never as paid.
 */
export async function loadPaidInfo(db: Db, salonId: string, sub: SubRow): Promise<PaidInfo> {
    const end = subscriptionEnd(sub);
    const { rows: inv } = await db.query(
        `SELECT i.id, i.invoice_no, i.subtotal, i.gst_percent, i.gst_amount, i.total, i.payment_mode, i.issued_at
         FROM subscription_invoices i
         LEFT JOIN subscription_payments pay ON pay.id = i.payment_id
         WHERE i.salon_id = $1 AND i.status = 'paid' AND COALESCE(pay.payment_status, 'paid') = 'paid'
           AND (
                i.subscription_id = $2
             OR (i.subscription_id IS NULL AND i.period_start IS NOT NULL AND i.period_end IS NOT NULL
                 AND $3::timestamp IS NOT NULL AND $4::timestamp IS NOT NULL
                 AND i.period_start <= $4::date AND i.period_end >= $3::date)
           )
         ORDER BY (i.subscription_id = $2) DESC NULLS LAST, i.issued_at DESC
         LIMIT 1`,
        [salonId, sub.id, sub.current_period_start?.toISOString() ?? null, end?.toISOString() ?? null]
    );
    if (inv[0]) {
        const r = inv[0];
        return {
            state: "paid", subtotal: Number(r.subtotal), gst_percent: Number(r.gst_percent), gst_amount: Number(r.gst_amount),
            total: Number(r.total), paid_at: dbDate(r.issued_at)?.toISOString() ?? null, reference: r.invoice_no, mode: r.payment_mode,
            invoice_id: r.id, source: "invoice",
        };
    }
    const { rows: pay } = await db.query(
        `SELECT p.id, p.amount, p.payment_method, p.transaction_id, p.paid_at
         FROM subscription_payments p
         WHERE p.subscription_id = $1 AND p.payment_status = 'paid'
         ORDER BY p.paid_at DESC NULLS LAST LIMIT 1`,
        [sub.id]
    );
    if (pay[0]) {
        const total = Math.round(Number(pay[0].amount) * 100) / 100;
        const subtotal = Math.round((total * 100) / (100 + GST_PERCENT)) / 100;
        return {
            state: "paid", subtotal, gst_percent: GST_PERCENT, gst_amount: Math.round((total - subtotal) * 100) / 100, total,
            paid_at: dbDate(pay[0].paid_at)?.toISOString() ?? null, reference: pay[0].transaction_id,
            mode: pay[0].payment_method ? String(pay[0].payment_method).toUpperCase() : "RAZORPAY", invoice_id: null, source: "payment",
        };
    }
    return NOT_RECORDED;
}

export interface CurrentSubscriptionView {
    id: string;
    plan_name: string | null;
    tier: Tier | null;
    cycle: Cycle | null;
    source: "razorpay" | "trial" | "manual";
    status: SubscriptionState;
    raw_status: string;
    period_start: string | null;
    period_end: string | null;
    days_remaining: number | null;
    cancel_at_period_end: boolean;
    assigned_price: number | null;
    payment: PaidInfo;
}

export const subscriptionBillingService = {
    async getCurrent(salonId: string) {
        const now = new Date();
        const policy = loadUpgradePolicy();
        const [{ rows: salonRows }, rows] = await Promise.all([
            pool.query(`SELECT is_active FROM salons WHERE id = $1`, [salonId]),
            loadSalonSubscriptions(pool, salonId),
        ]);
        const salonActive = salonRows[0] ? Boolean(salonRows[0].is_active) : true;
        const current = pickCurrentSubscription(rows, now);

        let subscription: CurrentSubscriptionView | null = null;
        if (current) {
            const end = subscriptionEnd(current);
            const tier = tierOfPlan({ tier: current.plan_tier, name: current.plan_name, slug: current.plan_slug });
            subscription = {
                id: current.id,
                plan_name: current.plan_name,
                tier,
                cycle: normalizeCycle(current.plan_cycle),
                source: current.razorpay_subscription_id ? "razorpay" : current.is_trial ? "trial" : "manual",
                status: deriveSubscriptionState({ status: current.status, periodEnd: end, now, salonActive }),
                raw_status: current.status,
                period_start: current.current_period_start ? current.current_period_start.toISOString() : null,
                period_end: end ? end.toISOString() : null,
                days_remaining: daysRemaining(end, now),
                cancel_at_period_end: current.cancel_at_period_end,
                assigned_price: current.plan_price != null ? Number(current.plan_price) : null,
                payment: current.status === "created" || current.status === "authenticated" ? NOT_RECORDED : await loadPaidInfo(pool, salonId, current),
            };
        }

        const live = subscription ? isLiveState(subscription.status) : false;
        const relations = {} as Record<Tier, Record<Cycle, PlanAction>>;
        for (const t of TIERS) {
            relations[t] = {} as Record<Cycle, PlanAction>;
            for (const c of CYCLES) {
                relations[t][c] = live && subscription?.cycle
                    ? relationOf({ tier: subscription.tier, cycle: subscription.cycle }, { tier: t, cycle: c })
                    : "new";
            }
        }

        // Anything started but not finished: an upgrade payment, or a plan checkout.
        const { rows: upRows } = await pool.query(
            `SELECT u.id, u.to_tier, u.to_cycle, u.total, u.created_at, u.razorpay_order_id, u.kind,
                    sp.name AS plan_name
             FROM subscription_upgrades u JOIN subscription_plans sp ON sp.id = u.to_plan_id
             WHERE u.salon_id = $1 AND u.status = 'pending'
               AND u.created_at > NOW() - ($2 || ' minutes')::interval
             ORDER BY u.created_at DESC LIMIT 1`,
            [salonId, String(policy.orderValidityMinutes)]
        );
        const checkout = rows.find((r) => (r.status === "created" || r.status === "authenticated") && r.razorpay_subscription_id);

        return {
            subscription,
            is_live: live,
            gst_percent: GST_PERCENT,
            relations,
            pending: {
                upgrade: upRows[0]
                    ? { id: upRows[0].id, plan_name: upRows[0].plan_name, tier: upRows[0].to_tier, cycle: upRows[0].to_cycle,
                        total: Number(upRows[0].total), created_at: dbDate(upRows[0].created_at)?.toISOString() ?? null }
                    : null,
                checkout: checkout && !live
                    ? { id: checkout.id, plan_name: checkout.plan_name, cycle: normalizeCycle(checkout.plan_cycle), created_at: checkout.created_at.toISOString() }
                    : null,
            },
        };
    },

    // Purchases, renewals, upgrades and plan changes (the issued invoices), plus the payments that did not succeed, and upgrade
    // attempts that were not completed. Nothing is overwritten: each purchase / renewal / upgrade is its own row.
    async getHistory(salonId: string) {
        const { rows } = await pool.query(
            `SELECT * FROM (
                SELECT 'invoice'::text AS source, i.id, i.invoice_no AS reference, i.issued_at AS occurred_at,
                       i.plan_name, i.billing_cycle, i.subtotal::float8 AS subtotal, i.gst_amount::float8 AS gst_amount,
                       i.total::float8 AS total, i.credit_amount::float8 AS credit,
                       CASE WHEN pay.payment_status = 'refunded' THEN 'refunded' ELSE 'paid' END AS status,
                       CASE WHEN i.kind <> 'purchase' THEN i.kind
                            WHEN ROW_NUMBER() OVER (PARTITION BY i.salon_id ORDER BY i.issued_at, i.created_at) = 1 THEN 'purchase'
                            ELSE 'renewal' END AS type,
                       i.id AS invoice_id, i.payment_mode AS mode, i.description
                FROM subscription_invoices i
                LEFT JOIN subscription_payments pay ON pay.id = i.payment_id
                WHERE i.salon_id = $1 AND i.status = 'paid'

                UNION ALL

                SELECT 'payment', p.id, p.transaction_id, COALESCE(p.paid_at, p.created_at),
                       sp.name, sp.billing_cycle, NULL, NULL, p.amount::float8, NULL, p.payment_status, 'payment',
                       NULL::uuid, UPPER(p.payment_method), NULL
                FROM subscription_payments p
                JOIN subscriptions s ON s.id = p.subscription_id
                LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
                WHERE s.salon_id = $1 AND p.payment_status <> 'paid'
                  AND NOT EXISTS (SELECT 1 FROM subscription_invoices i WHERE i.payment_id = p.id)

                UNION ALL

                SELECT 'upgrade', u.id, u.razorpay_order_id, u.created_at,
                       sp.name, u.to_cycle, u.subtotal::float8, u.gst_amount::float8, u.total::float8, u.credit_applied::float8,
                       CASE u.status WHEN 'cancelled' THEN 'cancelled' WHEN 'pending' THEN 'pending' WHEN 'needs_review' THEN 'needs_review' ELSE 'failed' END, 'upgrade',
                       NULL::uuid, 'RAZORPAY', u.failure_reason
                FROM subscription_upgrades u JOIN subscription_plans sp ON sp.id = u.to_plan_id
                WHERE u.salon_id = $1 AND u.status <> 'completed'
             ) h
             ORDER BY occurred_at DESC
             LIMIT 200`,
            [salonId]
        );
        return rows.map((r) => ({
            id: r.id as string,
            source: r.source as string,
            type: r.type as string,
            reference: (r.reference as string | null) ?? null,
            date: dbDate(r.occurred_at)?.toISOString() ?? null,
            plan_name: (r.plan_name as string | null) ?? null,
            billing_cycle: (r.billing_cycle as string | null) ?? null,
            subtotal: r.subtotal as number | null,
            gst_amount: r.gst_amount as number | null,
            total: r.total as number | null,
            credit: r.credit as number | null,
            status: r.status as string,
            invoice_id: (r.invoice_id as string | null) ?? null,
            mode: (r.mode as string | null) ?? null,
            note: (r.description as string | null) ?? null,
        }));
    },
};
