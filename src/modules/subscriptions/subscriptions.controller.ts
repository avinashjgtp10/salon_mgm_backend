import { Request, Response, NextFunction } from "express"
import { AppError } from "../../middleware/error.middleware"
import { sendSuccess } from "../utils/response.util"
import { subscriptionsService } from "./subscriptions.service"

type AuthRequest = Request & {
    user?: { userId: string; role?: string; salonId?: string | null }
}

export const subscriptionsController = {

    async createPlan(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const plan = await subscriptionsService.createPlan(req.body)
            return sendSuccess(res, 201, plan, "Plan created successfully")
        } catch (err) { return next(err) }
    },

    async listPlans(_req: Request, res: Response, next: NextFunction) {
        try {
            const plans = await subscriptionsService.listPlans()
            return sendSuccess(res, 200, plans, "Plans fetched successfully")
        } catch (err) { return next(err) }
    },

    async getPlan(req: Request, res: Response, next: NextFunction) {
        try {
            const plan = await subscriptionsService.getPlan(req.params.id as string)
            return sendSuccess(res, 200, plan, "Plan fetched successfully")
        } catch (err) { return next(err) }
    },

    async startTrial(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const result = await subscriptionsService.startTrial(req.body)
            return sendSuccess(res, 201, result, "14-day free trial started")
        } catch (err) { return next(err) }
    },

    async getTrialStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const status = await subscriptionsService.getTrialStatus(req.params.salonId as string)
            return sendSuccess(res, 200, status, "Trial status fetched")
        } catch (err) { return next(err) }
    },

    async createSubscription(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const result = await subscriptionsService.createSubscription(req.body)
            return sendSuccess(res, 201, result, "Subscription created successfully")
        } catch (err) { return next(err) }
    },

    // ── POST /api/v1/subscriptions/verify/:salonId ────────────────────────────
    // Called by frontend after Razorpay redirects back — verifies directly
    // with Razorpay API, no webhook needed. Works on localhost.
    async verifySubscription(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.params.salonId as string
            if (!salonId) throw new AppError(400, "salonId is required", "VALIDATION_ERROR")
            if (req.user?.role !== "admin" && req.user?.salonId !== salonId)
                throw new AppError(403, "Access denied", "FORBIDDEN")

            const result = await subscriptionsService.verifySubscription(salonId)
            if (!result) {
                throw new AppError(404, "No subscription found", "NOT_FOUND")
            }
            return sendSuccess(res, 200, result, "Subscription verified")
        } catch (err) { return next(err) }
    },

    async getSubscriptionsBySalon(req: Request, res: Response, next: NextFunction) {
        try {
            const subs = await subscriptionsService.getSubscriptionsBySalon(req.params.salonId as string)
            return sendSuccess(res, 200, subs, "Subscriptions fetched successfully")
        } catch (err) { return next(err) }
    },

    async getSubscription(req: Request, res: Response, next: NextFunction) {
        try {
            const sub = await subscriptionsService.getSubscription(req.params.id as string)
            return sendSuccess(res, 200, sub, "Subscription fetched successfully")
        } catch (err) { return next(err) }
    },

    async cancelSubscription(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await subscriptionsService.cancelSubscription(req.params.id as string, req.body)
            return sendSuccess(res, 200, result, "Subscription cancelled successfully")
        } catch (err) { return next(err) }
    },

    async getPayments(req: Request, res: Response, next: NextFunction) {
        try {
            const payments = await subscriptionsService.getPayments(req.params.id as string)
            return sendSuccess(res, 200, payments, "Payments fetched successfully")
        } catch (err) { return next(err) }
    },

    async webhook(req: Request, res: Response, next: NextFunction) {
        try {
            const signature = req.headers["x-razorpay-signature"] as string
            if (!signature)
                throw new AppError(400, "Missing signature", "VALIDATION_ERROR")

            const rawBody = JSON.stringify(req.body)
            const isValid = subscriptionsService.verifyWebhook(rawBody, signature)
            if (!isValid)
                throw new AppError(400, "Invalid webhook signature", "INVALID_SIGNATURE")

            await subscriptionsService.handleWebhookEvent(req.body.event, req.body.payload)

            return res.status(200).json({ received: true })
        } catch (err) { return next(err) }
    },
}