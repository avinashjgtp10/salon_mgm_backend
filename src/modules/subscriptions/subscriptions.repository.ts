import pool from "../../config/database"
import {
    SubscriptionPlan,
    Subscription,
    SubscriptionPayment,
} from "./subscriptions.types"

export const subscriptionsRepository = {

    // ─── Plans ──────────────────────────────────────────────────

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
