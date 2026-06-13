import Razorpay from "razorpay"
import crypto from "crypto"
import pool from "../../config/database"
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
        return subscriptionsRepository.createPlan({
            ...body,
            razorpay_plan_id: rzpPlan.id,
        })
    },

    async listPlans() {
        return subscriptionsRepository.listPlans()
    },

    async getPlan(id: string) {
        const plan = await subscriptionsRepository.findPlanById(id)
        if (!plan) throw new AppError(404, "Plan not found", "NOT_FOUND")
        return plan
    },

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

    async getTrialStatus(salonId: string) {
        const trial = await subscriptionsRepository.findActiveTrial(salonId)
        if (!trial) {
            const used = await subscriptionsRepository.hasUsedTrial(salonId)
            return { has_trial: false, trial_used: used, trial_days_remaining: 0 }
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

    async createSubscription(body: CreateSubscriptionBody) {
        const plan = await subscriptionsRepository.findPlanById(body.plan_id)
        if (!plan) throw new AppError(404, "Plan not found", "NOT_FOUND")
        if (!plan.razorpay_plan_id)
            throw new AppError(400, "Plan not synced with Razorpay", "INVALID_PLAN")

        const rzpSub = await razorpay.subscriptions.create({
            plan_id: plan.razorpay_plan_id,
            total_count: body.total_count || 12,
            customer_notify: 1,
            notes: {
                salon_id: body.salon_id,
                plan_id: body.plan_id,
            },
        } as any).catch((err: any) => {
            console.error("[createSubscription] Razorpay error:", JSON.stringify(err))
            throw new AppError(500, err?.error?.description || err?.message || "Razorpay subscription creation failed", "RAZORPAY_ERROR")
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

    async getSubscription(id: string) {
        const sub = await subscriptionsRepository.findSubscriptionById(id)
        if (!sub) throw new AppError(404, "Subscription not found", "NOT_FOUND")
        return sub
    },

    async getSubscriptionsBySalon(salonId: string) {
        return subscriptionsRepository.findBySalonId(salonId)
    },

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

    async getPayments(subscriptionId: string) {
        return subscriptionsRepository.listPaymentsBySubscription(subscriptionId)
    },

    // ── Verify subscription directly from Razorpay (no webhook needed) ──────
    async verifySubscription(salonId: string) {
        // Get latest subscription for this salon
        const subs = await subscriptionsRepository.findBySalonId(salonId)
        if (!subs || subs.length === 0) return null

        const latest = subs[0]
        if (!latest.razorpay_subscription_id) return null

        // Fetch live status from Razorpay
        let rzpSub: any
        try {
            rzpSub = await razorpay.subscriptions.fetch(latest.razorpay_subscription_id)
        } catch (err: any) {
            console.error("[verifySubscription] Razorpay fetch error:", err)
            throw new AppError(
                502,
                err?.error?.description || err?.message || "Failed to fetch subscription from Razorpay",
                "RAZORPAY_ERROR"
            )
        }

        if (rzpSub.status === "active" || rzpSub.status === "authenticated") {
            // Update local DB
            await subscriptionsRepository.updateSubscriptionStatus(
                latest.razorpay_subscription_id,
                "active",
                {
                    current_period_start: rzpSub.current_start
                        ? new Date(rzpSub.current_start * 1000).toISOString()
                        : undefined,
                    current_period_end: rzpSub.current_end
                        ? new Date(rzpSub.current_end * 1000).toISOString()
                        : undefined,
                }
            )

            // Sync to billing_subscriptions
            await pool.query(
                `INSERT INTO billing_subscriptions (
                    salon_id, plan_id, status,
                    unit_price, total_amount,
                    current_period_start, current_period_end
                )
                VALUES ($1, $2, 'active', $3, $3, $4, $5)
                ON CONFLICT (salon_id) WHERE status = 'active' DO NOTHING`,
                [
                    salonId,
                    latest.plan_id,
                    rzpSub.plan_data?.amount ? rzpSub.plan_data.amount / 100 : 0,
                    rzpSub.current_start ? new Date(rzpSub.current_start * 1000).toISOString() : new Date().toISOString(),
                    rzpSub.current_end ? new Date(rzpSub.current_end * 1000).toISOString() : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                ]
            )

            return { status: "active", subscription: latest }
        }

        return { status: rzpSub.status, subscription: latest }
    },

    verifyWebhook(rawBody: string, signature: string): boolean {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET!
        const expected = crypto
            .createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex")
        return expected === signature
    },

    async handleWebhookEvent(event: string, payload: any) {
        const subEntity = payload?.subscription?.entity
        const payEntity = payload?.payment?.entity

        switch (event) {

            case "subscription.activated": {
                await subscriptionsRepository.updateSubscriptionStatus(
                    subEntity.id, "active", {
                    current_period_start: typeof subEntity.current_start === 'number' && isFinite(subEntity.current_start)
                        ? new Date(subEntity.current_start * 1000).toISOString()
                        : undefined,
                    current_period_end: typeof subEntity.current_end === 'number' && isFinite(subEntity.current_end)
                        ? new Date(subEntity.current_end * 1000).toISOString()
                        : undefined,
                })
                const sub = await subscriptionsRepository.findByRazorpayId(subEntity.id)
                if (sub) {
                    await pool.query(
                        `INSERT INTO billing_subscriptions (
                            salon_id, plan_id, status,
                            unit_price, total_amount,
                            current_period_start, current_period_end
                        ) VALUES ($1,$2,'active',$3,$3,$4,$5)
                        ON CONFLICT (salon_id) WHERE status = 'active' DO NOTHING`,
                        [
                            sub.salon_id, sub.plan_id,
                            subEntity.plan_data?.amount ? subEntity.plan_data.amount / 100 : 0,
                            typeof subEntity.current_start === 'number' && isFinite(subEntity.current_start)
                                ? new Date(subEntity.current_start * 1000).toISOString()
                                : new Date().toISOString(),
                            typeof subEntity.current_end === 'number' && isFinite(subEntity.current_end)
                                ? new Date(subEntity.current_end * 1000).toISOString()
                                : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                        ]
                    )
                }
                break
            }

            case "subscription.charged": {
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
                    await pool.query(
                        `INSERT INTO invoices (
                            salon_id, invoice_number, status,
                            unit_price, subtotal, total_amount,
                            period_start, period_end, paid_at
                        ) VALUES ($1,$2,'paid',$3,$3,$3,$4,$5,NOW())`,
                        [
                            sub.salon_id, `INV-${crypto.randomUUID()}`,
                            payEntity.amount / 100,
                            subEntity.current_start ? new Date(subEntity.current_start * 1000).toISOString() : null,
                            subEntity.current_end ? new Date(subEntity.current_end * 1000).toISOString() : null,
                        ]
                    )
                }
                break
            }

            case "subscription.cancelled": {
                await subscriptionsRepository.updateSubscriptionStatus(
                    subEntity.id, "cancelled", { cancelled_at: new Date().toISOString() }
                )
                const sub = await subscriptionsRepository.findByRazorpayId(subEntity.id)
                if (sub) {
                    await pool.query(
                        `UPDATE billing_subscriptions
                         SET status='cancelled', cancelled_at=NOW(), updated_at=NOW()
                         WHERE salon_id=$1 AND status='active'`,
                        [sub.salon_id]
                    )
                }
                break
            }

            case "subscription.completed":
                await subscriptionsRepository.updateSubscriptionStatus(subEntity.id, "completed")
                break

            case "payment.failed": {
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
            }

            default:
                console.log("Unhandled webhook event:", event)
        }
    },
}