import pool from "../../config/database";
import {
    BillingPlan,
    BillingSubscription,
    BillingInvoice,
    SubscribeBillingBody,
    UpdateBillingSubscriptionBody,
    ListBillingInvoicesFilters,
} from "./billing.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodEndExpr(interval: string): string {
    return interval === "yearly"
        ? `NOW() + INTERVAL '1 year'`
        : `NOW() + INTERVAL '1 month'`;
}

// ─── Billing Plans ────────────────────────────────────────────────────────────

export const billingPlansRepository = {
    async findAll(): Promise<BillingPlan[]> {
        const { rows } = await pool.query(
            `SELECT * FROM billing_plans WHERE is_active = TRUE ORDER BY price_per_unit ASC`
        );
        return rows;
    },

    async findById(id: string): Promise<BillingPlan | null> {
        const { rows } = await pool.query(
            `SELECT * FROM billing_plans WHERE id = $1`, [id]
        );
        return rows[0] || null;
    },
};

// ─── Billing Subscriptions ────────────────────────────────────────────────────

export const billingSubscriptionsRepository = {
    async findById(id: string): Promise<BillingSubscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM billing_subscriptions WHERE id = $1`, [id]
        );
        return rows[0] || null;
    },

    async findActiveBySalonId(salonId: string): Promise<BillingSubscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM billing_subscriptions
       WHERE salon_id = $1 AND status IN ('trialing', 'active')
       ORDER BY created_at DESC LIMIT 1`,
            [salonId]
        );
        return rows[0] || null;
    },

    async findBySalonId(salonId: string): Promise<BillingSubscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM billing_subscriptions
       WHERE salon_id = $1
       ORDER BY created_at DESC LIMIT 1`,
            [salonId]
        );
        return rows[0] || null;
    },

    async create(
        data: SubscribeBillingBody,
        plan: BillingPlan,
        createdBy: string
    ): Promise<BillingSubscription> {
        const unitPrice = parseFloat(plan.price_per_unit);
        const totalAmount = unitPrice * data.quantity;
        const trialDays = plan.trial_days ?? 0;
        const periodExpr = periodEndExpr(plan.interval);
        const trialExpr = trialDays > 0
            ? `NOW() + INTERVAL '${trialDays} days'`
            : `NULL`;
        const initStatus = trialDays > 0 ? "trialing" : "active";

        const { rows } = await pool.query(
            `INSERT INTO billing_subscriptions (
        salon_id, plan_id,
        status, quantity, unit_price, total_amount,
        current_period_start, current_period_end,
        trial_ends_at,
        payment_method, card_holder_name, card_last4, card_brand, card_expiry,
        account_type, billing_first_name, billing_last_name, billing_address, vat_number,
        created_by
      )
      VALUES (
        $1, $2,
        $3, $4, $5, $6,
        NOW(), ${periodExpr},
        ${trialExpr},
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17
      )
      RETURNING *`,
            [
                data.salon_id,
                data.plan_id,
                initStatus,
                data.quantity,
                unitPrice,
                totalAmount,
                data.payment_method ?? null,
                data.card_holder_name ?? null,
                data.card_last4 ?? null,
                data.card_brand ?? null,
                data.card_expiry ?? null,
                data.account_type ?? null,
                data.billing_first_name ?? null,
                data.billing_last_name ?? null,
                data.billing_address ?? null,
                data.vat_number ?? null,
                createdBy,
            ]
        );
        return rows[0];
    },

    async update(
        id: string,
        patch: UpdateBillingSubscriptionBody,
        plan?: BillingPlan
    ): Promise<BillingSubscription> {
        const keys = Object.keys(patch) as (keyof UpdateBillingSubscriptionBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(
                `SELECT * FROM billing_subscriptions WHERE id = $1`, [id]
            );
            return rows[0];
        }

        const setParts: string[] = [];
        const values: unknown[] = [];

        keys.forEach((k, i) => {
            setParts.push(`${k} = $${i + 1}`);
            values.push((patch as Record<string, unknown>)[k]);
        });

        // recalculate total if quantity changed
        if (patch.quantity !== undefined && plan) {
            const newTotal = parseFloat(plan.price_per_unit) * patch.quantity;
            setParts.push(`total_amount = $${keys.length + 1}`);
            values.push(newTotal);
        }

        setParts.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await pool.query(
            `UPDATE billing_subscriptions
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );
        return rows[0];
    },

    async cancel(id: string, reason?: string): Promise<BillingSubscription> {
        const { rows } = await pool.query(
            `UPDATE billing_subscriptions
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancel_reason = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
            [reason ?? null, id]
        );
        return rows[0];
    },
};

// ─── Billing Invoices ─────────────────────────────────────────────────────────

export const billingInvoicesRepository = {
    async findById(id: string): Promise<BillingInvoice | null> {
        const { rows } = await pool.query(
            `SELECT * FROM invoices WHERE id = $1`, [id]
        );
        return rows[0] || null;
    },

    async list(
        filters: ListBillingInvoicesFilters
    ): Promise<{ data: BillingInvoice[]; total: number }> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`salon_id        = $${idx++}`); values.push(filters.salon_id); }
        if (filters.subscription_id) { conditions.push(`subscription_id = $${idx++}`); values.push(filters.subscription_id); }
        if (filters.status) { conditions.push(`status          = $${idx++}`); values.push(filters.status); }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM invoices ${where}`, values
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT * FROM invoices ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset]
        );
        return { data: rows, total };
    },
};
