"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionsRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.subscriptionsRepository = {
    // ─── Plans ──────────────────────────────────────────────────
    async createPlan(data) {
        const { rows } = await database_1.default.query(`INSERT INTO subscription_plans (
        name, slug, description, price, billing_cycle,
        features, max_branches, max_staff,
        max_bookings_per_month, ai_features_enabled,
        razorpay_plan_id, is_active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
      RETURNING *`, [
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
        ]);
        return rows[0];
    },
    async listPlans() {
        const { rows } = await database_1.default.query(`SELECT * FROM subscription_plans
       WHERE is_active = true
       ORDER BY price ASC`);
        return rows;
    },
    async findPlanById(id) {
        const { rows } = await database_1.default.query(`SELECT * FROM subscription_plans WHERE id = $1`, [id]);
        return rows[0] || null;
    },
    // ─── Subscriptions ──────────────────────────────────────────
    async createSubscription(data) {
        const { rows } = await database_1.default.query(`INSERT INTO subscriptions (
        salon_id, plan_id,
        razorpay_subscription_id, razorpay_plan_id,
        status, is_trial
      )
      VALUES ($1,$2,$3,$4,$5,false)
      RETURNING *`, [
            data.salon_id,
            data.plan_id,
            data.razorpay_subscription_id,
            data.razorpay_plan_id,
            data.status,
        ]);
        return rows[0];
    },
    async startTrial(data) {
        const trialStart = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);
        const { rows } = await database_1.default.query(`INSERT INTO subscriptions (
        salon_id, plan_id,
        status, is_trial,
        trial_start, trial_end
      )
      VALUES ($1,$2,'active',true,$3,$4)
      RETURNING *`, [
            data.salon_id,
            data.plan_id,
            trialStart.toISOString(),
            trialEnd.toISOString(),
        ]);
        return rows[0];
    },
    async findSubscriptionById(id) {
        const { rows } = await database_1.default.query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
        return rows[0] || null;
    },
    async findByRazorpayId(razorpaySubId) {
        const { rows } = await database_1.default.query(`SELECT * FROM subscriptions
       WHERE razorpay_subscription_id = $1`, [razorpaySubId]);
        return rows[0] || null;
    },
    async findBySalonId(salonId) {
        const { rows } = await database_1.default.query(`SELECT s.*, sp.name as plan_name, sp.price, sp.billing_cycle
       FROM subscriptions s
       JOIN subscription_plans sp ON s.plan_id = sp.id
       WHERE s.salon_id = $1
       ORDER BY s.created_at DESC`, [salonId]);
        return rows;
    },
    async findActiveTrial(salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM subscriptions
       WHERE salon_id = $1
         AND is_trial = true
         AND trial_end > NOW()
         AND status = 'active'
       LIMIT 1`, [salonId]);
        return rows[0] || null;
    },
    async hasUsedTrial(salonId) {
        const { rows } = await database_1.default.query(`SELECT id FROM subscriptions
       WHERE salon_id = $1 AND is_trial = true
       LIMIT 1`, [salonId]);
        return rows.length > 0;
    },
    async updateSubscriptionStatus(razorpaySubId, status, extra = {}) {
        const extraKeys = Object.keys(extra);
        const setParts = [`status = $1`, `updated_at = NOW()`];
        const values = [status];
        extraKeys.forEach((k, i) => {
            setParts.push(`${k} = $${i + 2}`);
            values.push(extra[k]);
        });
        values.push(razorpaySubId);
        const { rows } = await database_1.default.query(`UPDATE subscriptions
       SET ${setParts.join(", ")}
       WHERE razorpay_subscription_id = $${values.length}
       RETURNING *`, values);
        return rows[0];
    },
    // ─── Payments ───────────────────────────────────────────────
    async createPayment(data) {
        const { rows } = await database_1.default.query(`INSERT INTO subscription_payments (
        subscription_id, amount, payment_status,
        payment_method, transaction_id,
        billing_period_start, billing_period_end, paid_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`, [
            data.subscription_id,
            data.amount,
            data.payment_status,
            data.payment_method ?? null,
            data.transaction_id ?? null,
            data.billing_period_start ?? null,
            data.billing_period_end ?? null,
            data.paid_at ?? null,
        ]);
        return rows[0];
    },
    async listPaymentsBySubscription(subscriptionId) {
        const { rows } = await database_1.default.query(`SELECT * FROM subscription_payments
       WHERE subscription_id = $1
       ORDER BY created_at DESC`, [subscriptionId]);
        return rows;
    },
};
//# sourceMappingURL=subscriptions.repository.js.map