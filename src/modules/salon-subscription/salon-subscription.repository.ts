import pool from "../../config/database";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";

export const salonSubscriptionRepository = {
    async listActivePlans() {
        const { rows } = await pool.query(
            `SELECT id, name, price, billing_cycle
             FROM subscription_plans
             WHERE is_active = TRUE
             ORDER BY name ASC, price ASC`
        );
        return rows;
    },

    async findPlan(planId: string) {
        const { rows } = await pool.query(
            `SELECT id, name, price, billing_cycle, is_active FROM subscription_plans WHERE id = $1`,
            [planId]
        );
        return rows[0] ?? null;
    },

    async salonExists(salonId: string) {
        const { rows } = await pool.query(`SELECT 1 FROM salons WHERE id = $1`, [salonId]);
        return rows.length > 0;
    },

    // Newest first; includes the plan name/price so the admin page can show what the salon is on.
    async history(salonId: string, limit = 6) {
        // The price and currency the subscription was bought at (kept with it, so later exchange-rate moves never rewrite it).
        const purchase = (await billingSchemaReady())
            ? "s.country_code, s.pricing_currency, s.display_amount, s.charged_currency, s.charged_amount, s.fx_rate,"
            : "NULL::text AS country_code, NULL::text AS pricing_currency, NULL::numeric AS display_amount, NULL::text AS charged_currency, NULL::numeric AS charged_amount, NULL::numeric AS fx_rate,";
        const { rows } = await pool.query(
            `SELECT s.id, s.status, s.is_trial, s.current_period_start, s.current_period_end,
                    ${purchase}
                    s.trial_end, s.created_at, sp.name AS plan_name, sp.slug AS plan_slug, sp.tier AS plan_tier_col, sp.price, sp.billing_cycle
             FROM subscriptions s
             LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
             WHERE s.salon_id = $1
             ORDER BY s.created_at DESC
             LIMIT $2`,
            [salonId, limit]
        );
        return rows;
    },

    // The salon's current subscription: the newest active/trialing row, whether or not its end date has passed
    // (an expired one can be revived by moving its end date forward). Locked FOR UPDATE inside the caller's txn.
    async adjustExpiry(salonId: string, newEnd: Date) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const { rows } = await client.query(
                `SELECT id, status, is_trial, current_period_start, current_period_end, trial_end
                 FROM subscriptions
                 WHERE salon_id = $1 AND status IN ('active', 'trialing')
                 ORDER BY created_at DESC LIMIT 1
                 FOR UPDATE`,
                [salonId]
            );
            const row = rows[0];
            if (!row) { await client.query("ROLLBACK"); return null; }
            if (row.current_period_start && newEnd.getTime() <= new Date(row.current_period_start).getTime()) {
                await client.query("ROLLBACK");
                return "before_start" as const;
            }
            // A trial's end lives in trial_end, a paid plan's in current_period_end; keep both columns in step so
            // every screen that reads either one shows the same date.
            const upd = await client.query(
                `UPDATE subscriptions
                 SET current_period_end = $2,
                     trial_end = CASE WHEN status = 'trialing' OR is_trial THEN $2 ELSE trial_end END,
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, status, current_period_end, trial_end`,
                [row.id, newEnd.toISOString()]
            );
            await client.query("COMMIT");
            return { previous_end: row.status === "trialing" ? row.trial_end : row.current_period_end, updated: upd.rows[0] };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    // Gives the salon a paid plan for [start, end]. Any subscription still active for the salon is
    // cancelled in the same transaction so the new end date is the one that actually applies
    // (access is granted by ANY active, unexpired row — leaving an older one would override it).
    async grant(salonId: string, planId: string, start: Date, end: Date) {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const cancelled = await client.query(
                `UPDATE subscriptions
                 SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                 WHERE salon_id = $1 AND status IN ('active', 'trialing')
                 RETURNING id`,
                [salonId]
            );
            const { rows } = await client.query(
                `INSERT INTO subscriptions
                    (salon_id, plan_id, status, is_trial, current_period_start, current_period_end, cancel_at_period_end)
                 VALUES ($1, $2, 'active', FALSE, $3, $4, FALSE)
                 RETURNING id, status, current_period_start, current_period_end`,
                [salonId, planId, start.toISOString(), end.toISOString()]
            );
            await client.query("COMMIT");
            return { subscription: rows[0], replaced: cancelled.rowCount ?? 0 };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
