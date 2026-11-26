import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpay } from "../../config/razorpay";

// Subscription money matters that need a person: shown in Super Admin until somebody marks them resolved.
//   payment_review  money arrived for a prepaid / upgrade order that could not be applied (reference = the order's row id)
//   late_charge     Razorpay charged a subscription that had already been replaced or cancelled (reference = payment id)
//   stop_failed     an old subscription could not be stopped in Razorpay, so it may charge again (reference = subscription id)
//   refund          Razorpay refunded a subscription payment. Recorded only: access is NOT removed automatically (reference = refund id)

export type IssueKind = "payment_review" | "late_charge" | "stop_failed" | "refund";

export interface IssueInput {
    kind: IssueKind;
    reference: string;
    salonId?: string | null;
    amount?: number | null;
    currency?: string | null;
    details: string;
}

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
    if (!tableReady) {
        tableReady = pool
            .query(
                `CREATE TABLE IF NOT EXISTS subscription_billing_issues (
                   id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                   kind            VARCHAR(30)  NOT NULL,
                   reference       VARCHAR(120) NOT NULL,
                   salon_id        UUID,
                   amount          NUMERIC(12,2),
                   currency        VARCHAR(3),
                   details         TEXT,
                   status          VARCHAR(10)  NOT NULL DEFAULT 'open',
                   created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                   resolved_at     TIMESTAMPTZ,
                   resolved_by     UUID,
                   resolution_note TEXT,
                   UNIQUE (kind, reference)
                 )`,
            )
            .then(() => undefined)
            .catch((e) => { tableReady = null; throw e; });
    }
    return tableReady;
}

/** Never throws: recording a problem must not undo or fail the payment handling that found it. */
export async function recordBillingIssue(i: IssueInput): Promise<void> {
    logger.error("[billing-issue] needs attention", { kind: i.kind, reference: i.reference, salonId: i.salonId ?? null, details: i.details });
    try {
        await ensureTable();
        // A stop that fails again after being marked resolved is a live problem again; the other kinds are one-off events.
        const onRepeat = i.kind === "stop_failed"
            ? `DO UPDATE SET status = 'open', details = EXCLUDED.details, resolved_at = NULL, resolved_by = NULL, resolution_note = NULL`
            : `DO NOTHING`;
        await pool.query(
            `INSERT INTO subscription_billing_issues (kind, reference, salon_id, amount, currency, details)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (kind, reference) ${onRepeat}`,
            [i.kind, i.reference, i.salonId ?? null, i.amount ?? null, i.currency ?? null, i.details],
        );
    } catch (err: any) {
        logger.error("[billing-issue] could not be saved", { kind: i.kind, reference: i.reference, error: err?.message });
    }
}

const ALREADY_STOPPED = /already.*(cancel|complet)|has been cancelled|(cancelled|completed|expired) status|not cancellable/i;

/**
 * Stop a Razorpay subscription from charging again. `atCycleEnd` keeps it running to the end of the period already paid.
 * Returns false (and records a stop_failed issue) when Razorpay could not be told: it may then charge again.
 */
export async function stopRecurring(razorpaySubscriptionId: string, atCycleEnd: boolean, salonId?: string | null): Promise<boolean> {
    const cancel = async (end: boolean) => ((await getRazorpay()).subscriptions as any).cancel(razorpaySubscriptionId, end);
    const detailOf = (err: any) => String(err?.error?.description ?? err?.message ?? "unknown error");
    try {
        try {
            await cancel(atCycleEnd);
        } catch (err: any) {
            // Not started yet, so there is no cycle to wait for: cancel it outright.
            if (!(atCycleEnd && /no billing cycle/i.test(detailOf(err)))) throw err;
            await cancel(false);
        }
        return true;
    } catch (err: any) {
        const detail = detailOf(err);
        if (ALREADY_STOPPED.test(detail)) return true;
        await recordBillingIssue({
            kind: "stop_failed", reference: razorpaySubscriptionId, salonId,
            details: `Could not stop this Razorpay subscription, so it may charge the customer again: ${detail}`,
        });
        return false;
    }
}

/**
 * A new plan was just bought. A downgrade (or other change) that was scheduled earlier, or authorised but not started,
 * must not take over later and charge the customer for a plan they have moved on from. Never throws.
 */
export async function cancelPendingReplacements(salonId: string, exceptSubscriptionId?: string | null): Promise<void> {
    try {
        // to_jsonb keeps this working before the replaces_subscription_id column exists.
        const { rows } = await pool.query(
            `UPDATE subscriptions s SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
             WHERE s.salon_id = $1 AND s.razorpay_subscription_id IS NOT NULL
               AND ($2::text IS NULL OR s.id::text <> $2::text)
               AND (s.status = 'authenticated' OR (s.status = 'created' AND to_jsonb(s)->>'replaces_subscription_id' IS NOT NULL))
             RETURNING s.razorpay_subscription_id`,
            [salonId, exceptSubscriptionId ?? null],
        );
        for (const r of rows) await stopRecurring(r.razorpay_subscription_id, false, salonId);
    } catch (err: any) {
        logger.error("Cancelling scheduled plan changes failed", { salonId, error: err?.message });
    }
}

// Prepaid and upgrade orders parked for review before this screen existed (or while it could not be written) are picked up here.
async function importParkedOrders(): Promise<void> {
    const sources = [
        `SELECT 'payment_review', p.id::text, p.salon_id, p.amount, p.currency, COALESCE(p.failure_reason, 'Prepaid payment needs review')
           FROM subscription_payments p WHERE p.payment_status = 'needs_review' AND p.duration_value IS NOT NULL`,
        `SELECT 'payment_review', u.id::text, u.salon_id, u.total, NULL::varchar, COALESCE(u.failure_reason, 'Upgrade payment needs review')
           FROM subscription_upgrades u WHERE u.status = 'needs_review'`,
    ];
    for (const select of sources) {
        try {
            await pool.query(`INSERT INTO subscription_billing_issues (kind, reference, salon_id, amount, currency, details) ${select} ON CONFLICT (kind, reference) DO NOTHING`);
        } catch (err: any) {
            // 42P01 / 42703: that feature's migration has not been run on this database.
            if (err?.code !== "42P01" && err?.code !== "42703") logger.warn("[billing-issue] importing parked orders failed", { error: err?.message });
        }
    }
}

export const billingIssuesService = {
    async list(status: "open" | "resolved" = "open") {
        await ensureTable();
        await importParkedOrders();
        const { rows } = await pool.query(
            `SELECT i.id, i.kind, i.reference, i.salon_id, COALESCE(s.business_name, s.slug) AS salon_name, i.amount::float8 AS amount, i.currency,
                    i.details, i.status, i.created_at, i.resolved_at, i.resolution_note
             FROM subscription_billing_issues i LEFT JOIN salons s ON s.id = i.salon_id
             WHERE i.status = $1 ORDER BY i.created_at DESC LIMIT 200`,
            [status],
        );
        return rows;
    },

    async resolve(id: string, adminId: string, note: unknown) {
        await ensureTable();
        const text = String(note ?? "").trim();
        if (!text) throw new AppError(400, "Add a short note saying what was done.", "VALIDATION_ERROR");
        const { rows } = await pool.query(
            `UPDATE subscription_billing_issues SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution_note = $3
             WHERE id::text = $1 AND status = 'open' RETURNING id`,
            [id, adminId, text.slice(0, 500)],
        );
        if (!rows[0]) throw new AppError(404, "That item is not open.", "NOT_FOUND");
        return { resolved: true };
    },

    async retryStop(id: string, adminId: string) {
        await ensureTable();
        const { rows } = await pool.query(`SELECT reference, salon_id FROM subscription_billing_issues WHERE id::text = $1 AND kind = 'stop_failed' AND status = 'open'`, [id]);
        if (!rows[0]) throw new AppError(404, "That item is not open.", "NOT_FOUND");
        if (!(await stopRecurring(rows[0].reference, false, rows[0].salon_id))) {
            throw new AppError(424, "Razorpay still could not stop it. Cancel it in the Razorpay dashboard, then mark this resolved.", "RAZORPAY_ERROR");
        }
        return this.resolve(id, adminId, "Stopped in Razorpay (retried from Super Admin).");
    },
};
