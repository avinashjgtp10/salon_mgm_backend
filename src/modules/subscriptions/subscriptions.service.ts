import Razorpay from "razorpay"
import crypto from "crypto"
import { AppError } from "../../middleware/error.middleware"
import { subscriptionsRepository } from "./subscriptions.repository"
import {
    CreatePlanBody,
    CreateSubscriptionBody,
    StartTrialBody,
    CancelSubscriptionBody,
} from "./subscriptions.types"

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

export const subscriptionsService = {

    // ─── Create Plan ─────────────────────────────────────────────
    async createPlan(body: CreatePlanBody) {
        const rzpPlan = await razorpay.plans.create({
            period: body.billing_cycle,
            interval: 1,
            item: {
                name: body.name,
                amount: Math.round(body.price * 100),
                currency: "INR",
                description: body.description || "",
            },
        })

        const plan = await subscriptionsRepository.createPlan({
            ...body,
            razorpay_plan_id: rzpPlan.id,
        })

        return plan
    },

    // ─── List Plans ───────────────────────────────────────────────
    async listPlans() {
        return subscriptionsRepository.listPlans()
    },

    // ─── Get Plan ─────────────────────────────────────────────────
    async getPlan(id: string) {
        const plan = await subscriptionsRepository.findPlanById(id)
        if (!plan) throw new AppError(404, "Plan not found", "NOT_FOUND")
        return plan
    },

    // ─── Start 14-Day Trial ───────────────────────────────────────
    async startTrial(body: StartTrialBody) {
        const plan = await subscriptionsRepository.findPlanById(body.plan_id)
        if (!plan) throw new AppError(404, "Plan not found", "NOT_FOUND")

        const alreadyUsed = await subscriptionsRepository.hasUsedTrial(body.salon_id)
        if (alreadyUsed)
            throw new AppError(400, "Free trial already used for this salon", "TRIAL_USED")

        const activeTrial = await subscriptionsRepository.findActiveTrial(body.salon_id)
        if (activeTrial)
            throw new AppError(400, "Active trial already exists", "TRIAL_ACTIVE")

        const trial = await subscriptionsRepository.startTrial({
            salon_id: body.salon_id,
            plan_id: body.plan_id,
        })

        return {
            ...trial,
            trial_days_remaining: 14,
            message: "14-day free trial started successfully",
        }
    },

    // ─── Get Trial Status ─────────────────────────────────────────
    async getTrialStatus(salonId: string) {
        const trial = await subscriptionsRepository.findActiveTrial(salonId)

        if (!trial) {
            const used = await subscriptionsRepository.hasUsedTrial(salonId)
            return {
                has_trial: false,
                trial_used: used,
                trial_days_remaining: 0,
            }
        }

        const now = new Date()
        const trialEnd = new Date(trial.trial_end!)
        const daysRemaining = Math.ceil(
            (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        )

        return {
            has_trial: true,
            trial_used: true,
            trial_days_remaining: Math.max(0, daysRemaining),
            trial_start: trial.trial_start,
            trial_end: trial.trial_end,
        }
    },

    // ─── Create Subscription ─────────────────────────────────────
    async createSubscription(body: CreateSubscriptionBody) {
        const plan = await subscriptionsRepository.findPlanById(body.plan_id)
        if (!plan) throw new AppError(404, "Plan not found", "NOT_FOUND")
        if (!plan.razorpay_plan_id)
            throw new AppError(400, "Plan not synced with Razorpay", "INVALID_PLAN")

        const rzpSub = await razorpay.subscriptions.create({
            plan_id: plan.razorpay_plan_id,
            total_count: body.total_count || 12,
            customer_notify: 1,
        })

        const subscription = await subscriptionsRepository.createSubscription({
            salon_id: body.salon_id,
            plan_id: body.plan_id,
            razorpay_subscription_id: rzpSub.id,
            razorpay_plan_id: plan.razorpay_plan_id,
            status: "created",
        })

        return {
            subscription,
            razorpay_subscription_id: rzpSub.id,
            short_url: (rzpSub as any).short_url,
        }
    },

    // ─── Get Subscription ────────────────────────────────────────
    async getSubscription(id: string) {
        const sub = await subscriptionsRepository.findSubscriptionById(id)
        if (!sub) throw new AppError(404, "Subscription not found", "NOT_FOUND")
        return sub
    },

    // ─── Get By Salon ─────────────────────────────────────────────
    async getSubscriptionsBySalon(salonId: string) {
        return subscriptionsRepository.findBySalonId(salonId)
    },

    // ─── Cancel Subscription ─────────────────────────────────────
    async cancelSubscription(id: string, body: CancelSubscriptionBody) {
        const sub = await subscriptionsRepository.findSubscriptionById(id)
        if (!sub) throw new AppError(404, "Subscription not found", "NOT_FOUND")
        if (!sub.razorpay_subscription_id)
            throw new AppError(400, "No Razorpay subscription linked", "INVALID")

        await razorpay.subscriptions.cancel(
            sub.razorpay_subscription_id,
            body.cancel_at_cycle_end ?? false
        )

        return subscriptionsRepository.updateSubscriptionStatus(
            sub.razorpay_subscription_id,
            "cancelled",
            { cancelled_at: new Date().toISOString() }
        )
    },

    // ─── Get Payments ─────────────────────────────────────────────
    async getPayments(subscriptionId: string) {
        return subscriptionsRepository.listPaymentsBySubscription(subscriptionId)
    },

    // ─── Verify Webhook ──────────────────────────────────────────
    verifyWebhook(rawBody: string, signature: string): boolean {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET!
        const expected = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex")
        return expected === signature
    },

    // ─── Handle Webhook Events ───────────────────────────────────
    async handleWebhookEvent(event: string, payload: any) {
        const subEntity = payload?.subscription?.entity
        const payEntity = payload?.payment?.entity

        switch (event) {

            case "subscription.activated":
                await subscriptionsRepository.updateSubscriptionStatus(
                    subEntity.id, "active", {
                    current_period_start: new Date(subEntity.current_start * 1000).toISOString(),
                    current_period_end: new Date(subEntity.current_end * 1000).toISOString(),
                }
                )
                break

            case "subscription.charged":
                const sub = await subscriptionsRepository.findByRazorpayId(subEntity.id)
                if (sub) {
                    await subscriptionsRepository.createPayment({
                        subscription_id: sub.id,
                        amount: payEntity.amount / 100,
                        payment_status: "paid",
                        payment_method: payEntity.method,
                        transaction_id: payEntity.id,
                        paid_at: new Date().toISOString(),
                    })
                }
                break

            case "subscription.cancelled":
                await subscriptionsRepository.updateSubscriptionStatus(
                    subEntity.id, "cancelled", {
                    cancelled_at: new Date().toISOString(),
                }
                )
                break

            case "subscription.completed":
                await subscriptionsRepository.updateSubscriptionStatus(
                    subEntity.id, "completed"
                )
                break

            case "payment.failed":
                const subFailed = await subscriptionsRepository.findByRazorpayId(
                    payEntity?.subscription_id
                )
                if (subFailed) {
                    await subscriptionsRepository.createPayment({
                        subscription_id: subFailed.id,
                        amount: payEntity.amount / 100,
                        payment_status: "failed",
                        transaction_id: payEntity.id,
                    })
                }
                break

            default:
                console.log("Unhandled webhook event:", event)
        }
    },
}
