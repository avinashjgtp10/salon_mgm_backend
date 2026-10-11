import { Request, Response, NextFunction } from "express"
import { sendSuccess } from "../utils/response.util"
import { subscriptionsService } from "./subscriptions.service"

export const subscriptionsController = {

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

    async startTrial(req: Request, res: Response, next: NextFunction) {
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

    async getPayments(req: Request, res: Response, next: NextFunction) {
        try {
            const payments = await subscriptionsService.getPayments(req.params.id as string)
            return sendSuccess(res, 200, payments, "Payments fetched successfully")
        } catch (err) { return next(err) }
    },
}
