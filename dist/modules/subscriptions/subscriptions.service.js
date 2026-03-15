"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionsService = void 0;
const razorpay_1 = __importDefault(require("razorpay"));
const crypto_1 = __importDefault(require("crypto"));
const error_middleware_1 = require("../../middleware/error.middleware");
const subscriptions_repository_1 = require("./subscriptions.repository");
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});
exports.subscriptionsService = {
    // ─── Create Plan ─────────────────────────────────────────────
    async createPlan(body) {
        const rzpPlan = await razorpay.plans.create({
            period: body.billing_cycle,
            interval: 1,
            item: {
                name: body.name,
                amount: Math.round(body.price * 100),
                currency: "INR",
                description: body.description || "",
            },
        });
        const plan = await subscriptions_repository_1.subscriptionsRepository.createPlan({
            ...body,
            razorpay_plan_id: rzpPlan.id,
        });
        return plan;
    },
    // ─── List Plans ───────────────────────────────────────────────
    async listPlans() {
        return subscriptions_repository_1.subscriptionsRepository.listPlans();
    },
    // ─── Get Plan ─────────────────────────────────────────────────
    async getPlan(id) {
        const plan = await subscriptions_repository_1.subscriptionsRepository.findPlanById(id);
        if (!plan)
            throw new error_middleware_1.AppError(404, "Plan not found", "NOT_FOUND");
        return plan;
    },
    // ─── Start 14-Day Trial ───────────────────────────────────────
    async startTrial(body) {
        const plan = await subscriptions_repository_1.subscriptionsRepository.findPlanById(body.plan_id);
        if (!plan)
            throw new error_middleware_1.AppError(404, "Plan not found", "NOT_FOUND");
        const alreadyUsed = await subscriptions_repository_1.subscriptionsRepository.hasUsedTrial(body.salon_id);
        if (alreadyUsed)
            throw new error_middleware_1.AppError(400, "Free trial already used for this salon", "TRIAL_USED");
        const activeTrial = await subscriptions_repository_1.subscriptionsRepository.findActiveTrial(body.salon_id);
        if (activeTrial)
            throw new error_middleware_1.AppError(400, "Active trial already exists", "TRIAL_ACTIVE");
        const trial = await subscriptions_repository_1.subscriptionsRepository.startTrial({
            salon_id: body.salon_id,
            plan_id: body.plan_id,
        });
        return {
            ...trial,
            trial_days_remaining: 14,
            message: "14-day free trial started successfully",
        };
    },
    // ─── Get Trial Status ─────────────────────────────────────────
    async getTrialStatus(salonId) {
        const trial = await subscriptions_repository_1.subscriptionsRepository.findActiveTrial(salonId);
        if (!trial) {
            const used = await subscriptions_repository_1.subscriptionsRepository.hasUsedTrial(salonId);
            return {
                has_trial: false,
                trial_used: used,
                trial_days_remaining: 0,
            };
        }
        const now = new Date();
        const trialEnd = new Date(trial.trial_end);
        const daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
            has_trial: true,
            trial_used: true,
            trial_days_remaining: Math.max(0, daysRemaining),
            trial_start: trial.trial_start,
            trial_end: trial.trial_end,
        };
    },
    // ─── Create Subscription ─────────────────────────────────────
    async createSubscription(body) {
        const plan = await subscriptions_repository_1.subscriptionsRepository.findPlanById(body.plan_id);
        if (!plan)
            throw new error_middleware_1.AppError(404, "Plan not found", "NOT_FOUND");
        if (!plan.razorpay_plan_id)
            throw new error_middleware_1.AppError(400, "Plan not synced with Razorpay", "INVALID_PLAN");
        const rzpSub = await razorpay.subscriptions.create({
            plan_id: plan.razorpay_plan_id,
            total_count: body.total_count || 12,
            customer_notify: 1,
        });
        const subscription = await subscriptions_repository_1.subscriptionsRepository.createSubscription({
            salon_id: body.salon_id,
            plan_id: body.plan_id,
            razorpay_subscription_id: rzpSub.id,
            razorpay_plan_id: plan.razorpay_plan_id,
            status: "created",
        });
        return {
            subscription,
            razorpay_subscription_id: rzpSub.id,
            short_url: rzpSub.short_url,
        };
    },
    // ─── Get Subscription ────────────────────────────────────────
    async getSubscription(id) {
        const sub = await subscriptions_repository_1.subscriptionsRepository.findSubscriptionById(id);
        if (!sub)
            throw new error_middleware_1.AppError(404, "Subscription not found", "NOT_FOUND");
        return sub;
    },
    // ─── Get By Salon ─────────────────────────────────────────────
    async getSubscriptionsBySalon(salonId) {
        return subscriptions_repository_1.subscriptionsRepository.findBySalonId(salonId);
    },
    // ─── Cancel Subscription ─────────────────────────────────────
    async cancelSubscription(id, body) {
        const sub = await subscriptions_repository_1.subscriptionsRepository.findSubscriptionById(id);
        if (!sub)
            throw new error_middleware_1.AppError(404, "Subscription not found", "NOT_FOUND");
        if (!sub.razorpay_subscription_id)
            throw new error_middleware_1.AppError(400, "No Razorpay subscription linked", "INVALID");
        await razorpay.subscriptions.cancel(sub.razorpay_subscription_id, body.cancel_at_cycle_end ?? false);
        return subscriptions_repository_1.subscriptionsRepository.updateSubscriptionStatus(sub.razorpay_subscription_id, "cancelled", { cancelled_at: new Date().toISOString() });
    },
    // ─── Get Payments ─────────────────────────────────────────────
    async getPayments(subscriptionId) {
        return subscriptions_repository_1.subscriptionsRepository.listPaymentsBySubscription(subscriptionId);
    },
    // ─── Verify Webhook ──────────────────────────────────────────
    verifyWebhook(rawBody, signature) {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const expected = crypto_1.default
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex");
        return expected === signature;
    },
    // ─── Handle Webhook Events ───────────────────────────────────
    async handleWebhookEvent(event, payload) {
        const subEntity = payload?.subscription?.entity;
        const payEntity = payload?.payment?.entity;
        switch (event) {
            case "subscription.activated":
                await subscriptions_repository_1.subscriptionsRepository.updateSubscriptionStatus(subEntity.id, "active", {
                    current_period_start: new Date(subEntity.current_start * 1000).toISOString(),
                    current_period_end: new Date(subEntity.current_end * 1000).toISOString(),
                });
                break;
            case "subscription.charged":
                const sub = await subscriptions_repository_1.subscriptionsRepository.findByRazorpayId(subEntity.id);
                if (sub) {
                    await subscriptions_repository_1.subscriptionsRepository.createPayment({
                        subscription_id: sub.id,
                        amount: payEntity.amount / 100,
                        payment_status: "paid",
                        payment_method: payEntity.method,
                        transaction_id: payEntity.id,
                        paid_at: new Date().toISOString(),
                    });
                }
                break;
            case "subscription.cancelled":
                await subscriptions_repository_1.subscriptionsRepository.updateSubscriptionStatus(subEntity.id, "cancelled", {
                    cancelled_at: new Date().toISOString(),
                });
                break;
            case "subscription.completed":
                await subscriptions_repository_1.subscriptionsRepository.updateSubscriptionStatus(subEntity.id, "completed");
                break;
            case "payment.failed":
                const subFailed = await subscriptions_repository_1.subscriptionsRepository.findByRazorpayId(payEntity?.subscription_id);
                if (subFailed) {
                    await subscriptions_repository_1.subscriptionsRepository.createPayment({
                        subscription_id: subFailed.id,
                        amount: payEntity.amount / 100,
                        payment_status: "failed",
                        transaction_id: payEntity.id,
                    });
                }
                break;
            default:
                console.log("Unhandled webhook event:", event);
        }
    },
};
//# sourceMappingURL=subscriptions.service.js.map