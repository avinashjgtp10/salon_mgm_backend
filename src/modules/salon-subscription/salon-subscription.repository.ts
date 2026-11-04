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

    // Who to tell when a plan is given to the salon: its owner.
    async ownerContact(salonId: string): Promise<{ email: string | null; salon_name: string } | null> {
        const { rows } = await pool.query(
            `SELECT u.email, COALESCE(sa.business_name, sa.slug, 'your salon') AS salon_name
             FROM salons sa LEFT JOIN users u ON u.id = sa.owner_id
             WHERE sa.id = $1`,
            [salonId]
        );
        return rows[0] ?? null;
    },

    // Registered owners who have no salon yet (they have not paid, or not finished onboarding), with whether they have paid and the
    // state of their newest subscription. `payment`: paid | unpaid. `status`: the newest subscription's status, or "none".
    async usersWithoutSalon(f: { search?: string; payment?: string; status?: string }) {
        const where: string[] = [
            `u.role = 'salon_owner'`,
            `NOT EXISTS (SELECT 1 FROM salons sa WHERE sa.owner_id = u.id)`,
        ];
        const params: unknown[] = [];
        if (f.search) {
            params.push(`%${f.search}%`);
            where.push(`(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) ILIKE $${params.length}
                         OR u.email ILIKE $${params.length} OR COALESCE(u.phone, '') ILIKE $${params.length}
                         OR COALESCE(u.business_name, '') ILIKE $${params.length})`);
        }
        const { rows } = await pool.query(
            `SELECT * FROM (
                SELECT u.id, TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS name, u.email, u.phone, u.business_name, u.created_at,
                       EXISTS (SELECT 1 FROM subscription_payments p JOIN subscriptions s ON s.id = p.subscription_id
                               WHERE s.user_id = u.id AND p.payment_status = 'paid') AS paid,
                       ls.status AS subscription_status, ls.plan_name
                FROM users u
                LEFT JOIN LATERAL (
                    SELECT s.status, sp.name AS plan_name FROM subscriptions s LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
                    WHERE s.user_id = u.id AND s.salon_id IS NULL ORDER BY s.created_at DESC LIMIT 1
                ) ls ON TRUE
                WHERE ${where.join(" AND ")}
             ) x
             WHERE ($${params.length + 1}::text IS NULL OR x.paid = ($${params.length + 1} = 'paid'))
               AND ($${params.length + 2}::text IS NULL OR COALESCE(x.subscription_status, 'none') = $${params.length + 2})
             ORDER BY x.created_at DESC
             LIMIT 200`,
            [...params, f.payment === "paid" || f.payment === "unpaid" ? f.payment : null, f.status || null]
        );
        return rows;
    },

    // A user who has signed up but not created their salon yet.
    async userContact(userId: string): Promise<{ email: string | null; first_name: string | null; salon_id: string | null } | null> {
        const { rows } = await pool.query(
            `SELECT u.email, u.first_name, (SELECT sa.id FROM salons sa WHERE sa.owner_id = u.id LIMIT 1) AS salon_id
             FROM users u WHERE u.id = $1`,
            [userId]
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
