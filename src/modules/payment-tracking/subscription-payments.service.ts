import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { GST_PERCENT } from "../plan-pricing/plan-pricing.service";

// Payment Tracking > Subscription Payments: what salons pay for their plan, read straight from the Razorpay-driven tables
// (subscriptions, subscription_payments, subscription_invoices). Read-only: nothing here writes to, or changes, the Razorpay flow.
//
// One row per real salon: its current subscription, what that term costs, what Razorpay has collected for it, and what is left.
//   total     = the amount charged for the term including tax (the subscription's own charged amount, else plan price + GST)
//   paid      = captured Razorpay payments for the current term
//   status    = Completed (nothing left) / Overdue (unpaid past its due date, or Razorpay halted it) / Partial / Pending
//   next due  = the next renewal once paid; otherwise the date this term's payment was due (trial end for a trial)
// Subscriptions that Razorpay never saw (a plan given by hand, or a checkout never finished) are not listed.

const CURRENT = `
  WITH cur AS (
    SELECT DISTINCT ON (s.salon_id) s.*
      FROM subscriptions s
     WHERE s.status NOT IN ('created', 'authenticated', 'upgraded')
     ORDER BY s.salon_id, (s.status = 'active') DESC, s.created_at DESC
  ),
  base AS (
    SELECT cur.id AS subscription_id, cur.salon_id,
           COALESCE(NULLIF(TRIM(sa.business_name), ''), sa.slug) AS salon_name,
           TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS owner_name,
           u.email AS owner_email, u.phone AS owner_phone,
           sp.name AS plan_name, sp.billing_cycle,
           COALESCE(cur.charged_currency, 'INR') AS currency,
           cur.status AS subscription_status, cur.is_trial,
           pay.paid, pay.last_method, pay.last_paid_at,
           GREATEST(COALESCE(cur.charged_amount + COALESCE(cur.charged_tax, 0), ROUND(sp.price * (100 + $1) / 100, 2)), COALESCE(pay.paid, 0)) AS total,
           CASE WHEN COALESCE(pay.paid, 0) >= COALESCE(cur.charged_amount + COALESCE(cur.charged_tax, 0), ROUND(sp.price * (100 + $1) / 100, 2)) THEN cur.current_period_end::date
                WHEN cur.is_trial AND cur.trial_end IS NOT NULL THEN cur.trial_end::date
                ELSE cur.current_period_start::date END AS due_date
      FROM cur
      JOIN salons sa ON sa.id = cur.salon_id AND COALESCE(sa.is_dummy, FALSE) = FALSE
      LEFT JOIN users u ON u.id = sa.owner_id
      LEFT JOIN subscription_plans sp ON sp.id = cur.plan_id
      LEFT JOIN LATERAL (
        SELECT SUM(p.amount) FILTER (WHERE p.payment_status = 'paid'
                                       AND COALESCE(p.billing_period_start, p.paid_at::date) >= cur.current_period_start::date) AS paid,
               (ARRAY_AGG(p.payment_method ORDER BY p.paid_at DESC) FILTER (WHERE p.payment_status = 'paid'))[1] AS last_method,
               MAX(p.paid_at) FILTER (WHERE p.payment_status = 'paid') AS last_paid_at,
               COUNT(*) FILTER (WHERE p.payment_status = 'paid') AS paid_count
          FROM subscription_payments p WHERE p.subscription_id = cur.id
      ) pay ON TRUE
     -- only what Razorpay knows about; a cancelled one only if it was actually paid
     WHERE (cur.razorpay_subscription_id IS NOT NULL OR COALESCE(pay.paid_count, 0) > 0)
       AND (cur.status <> 'cancelled' OR COALESCE(pay.paid_count, 0) > 0)
  ),
  calc AS (
    SELECT base.*,
           ROUND(total, 2)::float8 AS total_amount,
           ROUND(COALESCE(paid, 0), 2)::float8 AS paid_amount,
           ROUND(GREATEST(total - COALESCE(paid, 0), 0), 2)::float8 AS remaining,
           CASE WHEN total - COALESCE(paid, 0) <= 0 THEN 'completed'
                WHEN subscription_status IN ('halted', 'pending', 'past_due') OR due_date < CURRENT_DATE THEN 'overdue'
                WHEN COALESCE(paid, 0) > 0 THEN 'partial'
                ELSE 'pending' END AS status
      FROM base
  )`;

export interface SubscriptionPaymentFilters { search?: string; plan?: string; status?: string; method?: string; from?: string; to?: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const subscriptionPaymentsService = {
    async list(f: SubscriptionPaymentFilters) {
        const params: any[] = [GST_PERCENT];
        const where: string[] = [];
        const add = (v: any) => { params.push(v); return `$${params.length}`; };
        if (f.search) { const p = add(`%${f.search}%`); where.push(`(salon_name ILIKE ${p} OR owner_name ILIKE ${p} OR owner_email ILIKE ${p} OR owner_phone ILIKE ${p})`); }
        if (f.plan && ["basic", "advance", "growth"].includes(f.plan)) where.push(`plan_name ILIKE ${add(`%${f.plan}%`)}`);
        if (f.status && ["completed", "partial", "pending", "overdue"].includes(f.status)) where.push(`status = ${add(f.status)}`);
        if (f.method) where.push(`last_method = ${add(f.method)}`);
        if (f.from && DATE_RE.test(f.from)) where.push(`due_date >= ${add(f.from)}::date`);
        if (f.to && DATE_RE.test(f.to)) where.push(`due_date <= ${add(f.to)}::date`);
        const { rows } = await pool.query(
            `${CURRENT}
             SELECT salon_id, subscription_id, salon_name, owner_name, owner_email, owner_phone, plan_name, billing_cycle, currency,
                    subscription_status, total_amount, paid_amount, remaining, status, due_date::text AS next_due_date,
                    last_method, last_paid_at
               FROM calc ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
              ORDER BY (status = 'overdue') DESC, due_date ASC NULLS LAST, salon_name ASC LIMIT 500`,
            params
        );
        return rows;
    },

    /** One salon: its current row plus every Razorpay payment it ever made (with the invoice, when one was issued), newest first. */
    async detail(salonId: string) {
        if (!/^[0-9a-f-]{36}$/i.test(salonId)) throw new AppError(400, "Invalid salon id", "VALIDATION_ERROR");
        const { rows } = await pool.query(
            `${CURRENT}
             SELECT salon_id, subscription_id, salon_name, owner_name, owner_email, owner_phone, plan_name, billing_cycle, currency,
                    subscription_status, total_amount, paid_amount, remaining, status, due_date::text AS next_due_date, last_method, last_paid_at
               FROM calc WHERE salon_id = $2`,
            [GST_PERCENT, salonId]
        );
        if (!rows[0]) throw new AppError(404, "No Razorpay subscription for this salon", "NOT_FOUND");
        const { rows: payments } = await pool.query(
            `SELECT p.id, ROUND(p.amount, 2)::float8 AS amount, COALESCE(p.currency, 'INR') AS currency, p.payment_status AS status,
                    p.payment_method AS method, p.transaction_id, p.paid_at, p.billing_period_start::text AS period_start, p.billing_period_end::text AS period_end,
                    sp.name AS plan_name, sp.billing_cycle, i.id AS invoice_id, i.invoice_no
               FROM subscription_payments p
               JOIN subscriptions s ON s.id = p.subscription_id
               LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
               LEFT JOIN subscription_invoices i ON i.payment_id = p.id AND i.status <> 'void'
              WHERE s.salon_id = $1
              ORDER BY COALESCE(p.paid_at, p.created_at) DESC LIMIT 100`,
            [salonId]
        );
        // Manual payments recorded against this same salon, so the popup can show every payment amount in one place.
        // They stay in Manual Payments (nothing is copied or added to the Razorpay figures above).
        let manual: unknown[] = [];
        try {
            ({ rows: manual } = await pool.query(
                `SELECT p.id, ROUND(p.amount, 2)::float8 AS amount, p.paid_on::text AS paid_on, p.method, p.reference, r.item_label, r.id AS receivable_id
                   FROM admin_receivable_payments p JOIN admin_receivables r ON r.id = p.receivable_id
                  WHERE r.salon_id = $1 AND r.kind = 'customer' AND p.voided_at IS NULL
                  ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 100`,
                [salonId]
            ));
        } catch { /* the manual-payment tables aren't there yet: only Razorpay payments are shown */ }
        return { row: rows[0], payments, manual_payments: manual };
    },
};
