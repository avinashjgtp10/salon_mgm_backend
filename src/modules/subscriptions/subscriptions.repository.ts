import pool from "../../config/database"
import {
    SubscriptionPlan,
    Subscription,
    SubscriptionPayment,
    CreatePlanBody,
    SubscriptionStatus,
} from "./subscriptions.types"

export const subscriptionsRepository = {

    // ─── Plans ──────────────────────────────────────────────────

    async createPlan(data: CreatePlanBody & {
        razorpay_plan_id: string
    }): Promise<SubscriptionPlan> {
        const { rows } = await pool.query(
            `INSERT INTO subscription_plans (
        name, slug, description, price, billing_cycle,
        features, max_branches, max_staff,
        max_bookings_per_month, ai_features_enabled,
        razorpay_plan_id, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
      RETURNING *`,
            [
                data.name,
                data.slug,
                data.description ?? null,
                data.price,
                data.billing_cycle,
                data.features ? JSON.stringify(data.features) : null,
                data.max_branches ?? null,
                data.max_staff ?? null,
                data.max_bookings_per_month ?? null,
                data.ai_features_enabled ?? false,
                data.razorpay_plan_id,
            ]
        )
        return rows[0]
    },

    async listPlans(): Promise<SubscriptionPlan[]> {
        const { rows } = await pool.query(
            `SELECT * FROM subscription_plans
       WHERE is_active = true
       ORDER BY price ASC`
        )
        return rows
    },

    async findPlanById(id: string): Promise<SubscriptionPlan | null> {
        const { rows } = await pool.query(
            `SELECT * FROM subscription_plans WHERE id = $1`, [id]
        )
        return rows[0] || null
    },

    // ─── Subscriptions ──────────────────────────────────────────

    async createSubscription(data: {
        salon_id: string
        plan_id: string
        razorpay_subscription_id: string
        razorpay_plan_id: string
        status: SubscriptionStatus
    }): Promise<Subscription> {
        const { rows } = await pool.query(
            `INSERT INTO subscriptions (
        salon_id, plan_id,
        razorpay_subscription_id, razorpay_plan_id,
        status, is_trial
      )
      VALUES ($1,$2,$3,$4,$5,false)
      RETURNING *`,
            [
                data.salon_id,
                data.plan_id,
                data.razorpay_subscription_id,
                data.razorpay_plan_id,
                data.status,
            ]
        )
        return rows[0]
    },

    async startTrial(data: {
        salon_id: string
        plan_id: string
    }): Promise<Subscription> {
        const trialStart = new Date()
        const trialEnd = new Date()
        trialEnd.setDate(trialEnd.getDate() + 14)

        const { rows } = await pool.query(
            `INSERT INTO subscriptions (
        salon_id, plan_id,
        status, is_trial,
        trial_start, trial_end
      )
      VALUES ($1,$2,'active',true,$3,$4)
      RETURNING *`,
            [
                data.salon_id,
                data.plan_id,
                trialStart.toISOString(),
                trialEnd.toISOString(),
            ]
        )
        return rows[0]
    },

    async findSubscriptionById(id: string): Promise<Subscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM subscriptions WHERE id = $1`, [id]
        )
        return rows[0] || null
    },

    async findByRazorpayId(razorpaySubId: string): Promise<Subscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM subscriptions
       WHERE razorpay_subscription_id = $1`, [razorpaySubId]
        )
        return rows[0] || null
    },

    async findBySalonId(salonId: string): Promise<Subscription[]> {
        const { rows } = await pool.query(
            `SELECT s.*, sp.name as plan_name, sp.price, sp.billing_cycle
       FROM subscriptions s
       JOIN subscription_plans sp ON s.plan_id = sp.id
       WHERE s.salon_id = $1
       ORDER BY s.created_at DESC`,
            [salonId]
        )
        return rows
    },

    async findActiveTrial(salonId: string): Promise<Subscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM subscriptions
       WHERE salon_id = $1
         AND is_trial = true
         AND trial_end > NOW()
         AND status = 'active'
       LIMIT 1`,
            [salonId]
        )
        return rows[0] || null
    },

    async hasUsedTrial(salonId: string): Promise<boolean> {
        const { rows } = await pool.query(
            `SELECT id FROM subscriptions
       WHERE salon_id = $1 AND is_trial = true
       LIMIT 1`,
            [salonId]
        )
        return rows.length > 0
    },

    async findMostRecentBySalonId(salonId: string): Promise<Subscription | null> {
        const { rows } = await pool.query(
            `SELECT * FROM subscriptions
       WHERE salon_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
            [salonId]
        )
        return rows[0] || null
    },

    // Super-admin manual comp/override — extends (or backfills, if the
    // current period already lapsed) current_period_end by `days` from
    // whichever is later: now, or the existing current_period_end. Also
    // forces status back to 'active' so useSubscriptionPoller's
    // ["active","trialing"].includes(status) check passes immediately —
    // this is the one field that actually drives the SubscriptionWall.
    async extendSubscriptionDays(subscriptionId: string, days: number): Promise<Subscription> {
        const { rows } = await pool.query(
            `UPDATE subscriptions
       SET current_period_end = GREATEST(current_period_end, NOW()) + ($2 || ' days')::interval,
           status = 'active',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
            [subscriptionId, days]
        )
        return rows[0]
    },

    // Super-admin manual comp/override for an account with NO existing
    // subscription row at all — creates one directly, bypassing Razorpay
    // entirely (razorpay_subscription_id/razorpay_plan_id stay NULL, which
    // every consumer of those fields already null-guards against). Needs
    // SOME plan_id (subscriptions.plan_id is NOT NULL, FK'd to
    // subscription_plans) — caller passes whichever plan it picked;
    // current_period_end is exactly `days` from now, nothing more.
    async createManualSubscription(data: {
        salon_id: string
        plan_id: string
        days: number
    }): Promise<Subscription> {
        const { rows } = await pool.query(
            `INSERT INTO subscriptions (
                salon_id, plan_id, razorpay_subscription_id, razorpay_plan_id,
                status, is_trial, current_period_start, current_period_end
            )
            VALUES ($1, $2, NULL, NULL, 'active', false, NOW(), NOW() + ($3 || ' days')::interval)
            RETURNING *`,
            [data.salon_id, data.plan_id, data.days]
        )
        return rows[0]
    },

    // Super-admin manual "Apply Subscription" — sets an explicit
    // current_period_start/end (rather than +N days from now) and forces
    // status back to 'active', same reasoning as extendSubscriptionDays.
    async applySubscriptionDates(subscriptionId: string, startDate: string, endDate: string): Promise<Subscription> {
        const { rows } = await pool.query(
            `UPDATE subscriptions
       SET current_period_start = $2,
           current_period_end = $3,
           status = 'active',
           cancel_at_period_end = false,
           cancelled_at = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
            [subscriptionId, startDate, endDate]
        )
        return rows[0]
    },

    // Counterpart to createManualSubscription, but with explicit dates
    // instead of a day count — used when the account has no subscription
    // row yet and a super-admin applies one directly via start/end dates.
    async createManualSubscriptionWithDates(data: {
        salon_id: string
        plan_id: string
        start_date: string
        end_date: string
    }): Promise<Subscription> {
        const { rows } = await pool.query(
            `INSERT INTO subscriptions (
                salon_id, plan_id, razorpay_subscription_id, razorpay_plan_id,
                status, is_trial, current_period_start, current_period_end
            )
            VALUES ($1, $2, NULL, NULL, 'active', false, $3, $4)
            RETURNING *`,
            [data.salon_id, data.plan_id, data.start_date, data.end_date]
        )
        return rows[0]
    },

    // Super-admin "Remove Subscription" — immediately deactivates, same
    // shape as the Razorpay webhook cancellation path (subscriptions.service.ts).
    // billingSlice's fetchSubscriptionStatusThunk treats the salon as active
    // if ANY of its subscription rows is 'active' or 'trialing' (not just
    // the most recent) — so removing a subscription must deactivate every
    // such row for the salon, or an older row (e.g. a leftover trial, which
    // is stored as is_trial=true + status='active', not a literal
    // 'trialing' status) keeps the account unlocked even after the
    // "current" one is cancelled.
    async deactivateAllForSalon(salonId: string): Promise<Subscription[]> {
        const { rows } = await pool.query(
            `UPDATE subscriptions
       SET status = 'cancelled',
           cancelled_at = NOW(),
           current_period_end = NULL,
           updated_at = NOW()
       WHERE salon_id = $1
         AND status IN ('active', 'authenticated', 'paused')
       RETURNING *`,
            [salonId]
        )
        return rows
    },

    async updateSubscriptionStatus(
        razorpaySubId: string,
        status: SubscriptionStatus,
        extra: Record<string, unknown> = {}
    ): Promise<Subscription> {
        const extraKeys = Object.keys(extra)
        const setParts = [`status = $1`, `updated_at = NOW()`]
        const values: unknown[] = [status]

        extraKeys.forEach((k, i) => {
            setParts.push(`${k} = $${i + 2}`)
            values.push(extra[k])
        })

        values.push(razorpaySubId)

        const { rows } = await pool.query(
            `UPDATE subscriptions
       SET ${setParts.join(", ")}
       WHERE razorpay_subscription_id = $${values.length}
       RETURNING *`,
            values
        )
        return rows[0]
    },

    // ─── Payments ───────────────────────────────────────────────

    async createPayment(data: {
        subscription_id: string
        amount: number
        payment_status: string
        payment_method?: string
        transaction_id?: string
        billing_period_start?: string
        billing_period_end?: string
        paid_at?: string
    }): Promise<SubscriptionPayment> {
        const { rows } = await pool.query(
            `INSERT INTO subscription_payments (
        subscription_id, amount, payment_status,
        payment_method, transaction_id,
        billing_period_start, billing_period_end, paid_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
            [
                data.subscription_id,
                data.amount,
                data.payment_status,
                data.payment_method ?? null,
                data.transaction_id ?? null,
                data.billing_period_start ?? null,
                data.billing_period_end ?? null,
                data.paid_at ?? null,
            ]
        )
        return rows[0]
    },

    async listPaymentsBySubscription(subscriptionId: string): Promise<SubscriptionPayment[]> {
        const { rows } = await pool.query(
            `SELECT * FROM subscription_payments
       WHERE subscription_id = $1
       ORDER BY created_at DESC`,
            [subscriptionId]
        )
        return rows
    },
}
