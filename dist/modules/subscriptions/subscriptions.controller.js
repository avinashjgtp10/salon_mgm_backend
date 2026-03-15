"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionsController = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const subscriptions_service_1 = require("./subscriptions.service");
exports.subscriptionsController = {
    // POST /api/v1/subscriptions/plans
    async createPlan(req, res, next) {
        try {
            const plan = await subscriptions_service_1.subscriptionsService.createPlan(req.body);
            return (0, response_util_1.sendSuccess)(res, 201, plan, "Plan created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // GET /api/v1/subscriptions/plans
    async listPlans(_req, res, next) {
        try {
            const plans = await subscriptions_service_1.subscriptionsService.listPlans();
            return (0, response_util_1.sendSuccess)(res, 200, plans, "Plans fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // GET /api/v1/subscriptions/plans/:id
    async getPlan(req, res, next) {
        try {
            const plan = await subscriptions_service_1.subscriptionsService.getPlan(req.params.id);
            return (0, response_util_1.sendSuccess)(res, 200, plan, "Plan fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // POST /api/v1/subscriptions/trial
    async startTrial(req, res, next) {
        try {
            const result = await subscriptions_service_1.subscriptionsService.startTrial(req.body);
            return (0, response_util_1.sendSuccess)(res, 201, result, "14-day free trial started");
        }
        catch (err) {
            return next(err);
        }
    },
    // GET /api/v1/subscriptions/trial/:salonId
    async getTrialStatus(req, res, next) {
        try {
            const status = await subscriptions_service_1.subscriptionsService.getTrialStatus(req.params.salonId);
            return (0, response_util_1.sendSuccess)(res, 200, status, "Trial status fetched");
        }
        catch (err) {
            return next(err);
        }
    },
    // POST /api/v1/subscriptions
    async createSubscription(req, res, next) {
        try {
            const result = await subscriptions_service_1.subscriptionsService.createSubscription(req.body);
            return (0, response_util_1.sendSuccess)(res, 201, result, "Subscription created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // GET /api/v1/subscriptions/salon/:salonId
    async getSubscriptionsBySalon(req, res, next) {
        try {
            const subs = await subscriptions_service_1.subscriptionsService.getSubscriptionsBySalon(req.params.salonId);
            return (0, response_util_1.sendSuccess)(res, 200, subs, "Subscriptions fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // GET /api/v1/subscriptions/:id
    async getSubscription(req, res, next) {
        try {
            const sub = await subscriptions_service_1.subscriptionsService.getSubscription(req.params.id);
            return (0, response_util_1.sendSuccess)(res, 200, sub, "Subscription fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // POST /api/v1/subscriptions/:id/cancel
    async cancelSubscription(req, res, next) {
        try {
            const result = await subscriptions_service_1.subscriptionsService.cancelSubscription(req.params.id, req.body);
            return (0, response_util_1.sendSuccess)(res, 200, result, "Subscription cancelled successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // GET /api/v1/subscriptions/:id/payments
    async getPayments(req, res, next) {
        try {
            const payments = await subscriptions_service_1.subscriptionsService.getPayments(req.params.id);
            return (0, response_util_1.sendSuccess)(res, 200, payments, "Payments fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    // POST /api/v1/subscriptions/webhook
    async webhook(req, res, next) {
        try {
            const signature = req.headers["x-razorpay-signature"];
            if (!signature)
                throw new error_middleware_1.AppError(400, "Missing signature", "VALIDATION_ERROR");
            const rawBody = JSON.stringify(req.body);
            const isValid = subscriptions_service_1.subscriptionsService.verifyWebhook(rawBody, signature);
            if (!isValid)
                throw new error_middleware_1.AppError(400, "Invalid webhook signature", "INVALID_SIGNATURE");
            await subscriptions_service_1.subscriptionsService.handleWebhookEvent(req.body.event, req.body.payload);
            return res.status(200).json({ received: true });
        }
        catch (err) {
            return next(err);
        }
    },
};
//# sourceMappingURL=subscriptions.controller.js.map