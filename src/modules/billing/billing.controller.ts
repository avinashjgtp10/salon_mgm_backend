import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { billingService } from "./billing.service";
import {
    SubscribeBillingBody,
    UpdateBillingSubscriptionBody,
    CancelBillingSubscriptionBody,
    ListBillingInvoicesFilters,
} from "./billing.types";

type AuthRequest = Request & { user?: { userId: string; role?: string } };

export const billingController = {

    // GET /api/v1/billing/plans
    async listPlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            logger.info("GET /billing/plans");
            const plans = await billingService.listPlans();
            sendSuccess(res, 200, plans, "Billing plans fetched successfully");
        } catch (err) { next(err); }
    },

    // GET /api/v1/billing/plans/:id
    async getPlanById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const plan = await billingService.getPlanById(id);
            sendSuccess(res, 200, plan, "Billing plan fetched successfully");
        } catch (err) { next(err); }
    },

    // GET /api/v1/billing/subscription?salon_id=
    async getSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = String(req.query.salon_id || "").trim();
            if (!salonId) throw new AppError(400, "salon_id query param is required", "VALIDATION_ERROR");
            const sub = await billingService.getSubscription(salonId);
            sendSuccess(res, 200, sub, "Billing subscription fetched successfully");
        } catch (err) { next(err); }
    },

    // POST /api/v1/billing/subscribe  ← "Enable" button
    async subscribe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const subscription = await billingService.subscribe({
                requesterUserId: userId,
                body: req.body as SubscribeBillingBody,
            });
            sendSuccess(res, 201, subscription, "Billing subscription created successfully");
        } catch (err) { next(err); }
    },

    // PATCH /api/v1/billing/subscription/:id
    async updateSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await billingService.updateSubscription({
                subscriptionId: id,
                requesterUserId: userId,
                patch: req.body as UpdateBillingSubscriptionBody,
            });
            sendSuccess(res, 200, updated, "Billing subscription updated successfully");
        } catch (err) { next(err); }
    },

    // POST /api/v1/billing/subscription/:id/cancel
    async cancelSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const cancelled = await billingService.cancelSubscription({
                subscriptionId: id,
                requesterUserId: userId,
                body: req.body as CancelBillingSubscriptionBody,
            });
            sendSuccess(res, 200, cancelled, "Billing subscription cancelled");
        } catch (err) { next(err); }
    },

    // GET /api/v1/billing/invoices
    async listInvoices(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const filters: ListBillingInvoicesFilters = {
                salon_id: req.query.salon_id as string | undefined,
                subscription_id: req.query.subscription_id as string | undefined,
                status: req.query.status as string | undefined,
                page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
            };
            const result = await billingService.listInvoices(filters);
            sendSuccess(res, 200, result, "Invoices fetched successfully");
        } catch (err) { next(err); }
    },

    // GET /api/v1/billing/invoices/:id
    async getInvoice(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const invoice = await billingService.getInvoice(id);
            sendSuccess(res, 200, invoice, "Invoice fetched successfully");
        } catch (err) { next(err); }
    },
};
