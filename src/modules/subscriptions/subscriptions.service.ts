import { AppError } from "../../middleware/error.middleware"
import { subscriptionsRepository } from "./subscriptions.repository"
import { StartTrialBody } from "./subscriptions.types"

export const subscriptionsService = {

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

    async getSubscription(id: string) {
        const sub = await subscriptionsRepository.findSubscriptionById(id)
        if (!sub) throw new AppError(404, "Subscription not found", "NOT_FOUND")
        return sub
    },

    async getSubscriptionsBySalon(salonId: string) {
        return subscriptionsRepository.findBySalonId(salonId)
    },

    async getPayments(subscriptionId: string) {
        return subscriptionsRepository.listPaymentsBySubscription(subscriptionId)
    },
}
