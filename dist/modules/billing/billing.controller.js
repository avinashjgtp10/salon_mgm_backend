"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingController = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const billing_service_1 = require("./billing.service");
exports.billingController = {
    // GET /api/v1/billing/plans
    async listPlans(_req, res, next) {
        try {
            logger_1.default.info("GET /billing/plans");
            const plans = await billing_service_1.billingService.listPlans();
            (0, response_util_1.sendSuccess)(res, 200, plans, "Billing plans fetched successfully");
        }
        catch (err) {
            next(err);
        }
    },
    // GET /api/v1/billing/plans/:id
    async getPlanById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const plan = await billing_service_1.billingService.getPlanById(id);
            (0, response_util_1.sendSuccess)(res, 200, plan, "Billing plan fetched successfully");
        }
        catch (err) {
            next(err);
        }
    },
    // GET /api/v1/billing/subscription?salon_id=
    async getSubscription(req, res, next) {
        try {
            const salonId = String(req.query.salon_id || "").trim();
            if (!salonId)
                throw new error_middleware_1.AppError(400, "salon_id query param is required", "VALIDATION_ERROR");
            const sub = await billing_service_1.billingService.getSubscription(salonId);
            (0, response_util_1.sendSuccess)(res, 200, sub, "Billing subscription fetched successfully");
        }
        catch (err) {
            next(err);
        }
    },
    // POST /api/v1/billing/subscribe  ← "Enable" button
    async subscribe(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const subscription = await billing_service_1.billingService.subscribe({
                requesterUserId: userId,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 201, subscription, "Billing subscription created successfully");
        }
        catch (err) {
            next(err);
        }
    },
    // PATCH /api/v1/billing/subscription/:id
    async updateSubscription(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await billing_service_1.billingService.updateSubscription({
                subscriptionId: id,
                requesterUserId: userId,
                patch: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 200, updated, "Billing subscription updated successfully");
        }
        catch (err) {
            next(err);
        }
    },
    // POST /api/v1/billing/subscription/:id/cancel
    async cancelSubscription(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const cancelled = await billing_service_1.billingService.cancelSubscription({
                subscriptionId: id,
                requesterUserId: userId,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 200, cancelled, "Billing subscription cancelled");
        }
        catch (err) {
            next(err);
        }
    },
    // GET /api/v1/billing/invoices
    async listInvoices(req, res, next) {
        try {
            const filters = {
                salon_id: req.query.salon_id,
                subscription_id: req.query.subscription_id,
                status: req.query.status,
                page: req.query.page ? parseInt(req.query.page, 10) : 1,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : 20,
            };
            const result = await billing_service_1.billingService.listInvoices(filters);
            (0, response_util_1.sendSuccess)(res, 200, result, "Invoices fetched successfully");
        }
        catch (err) {
            next(err);
        }
    },
    // GET /api/v1/billing/invoices/:id
    async getInvoice(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const invoice = await billing_service_1.billingService.getInvoice(id);
            (0, response_util_1.sendSuccess)(res, 200, invoice, "Invoice fetched successfully");
        }
        catch (err) {
            next(err);
        }
    },
};
//# sourceMappingURL=billing.controller.js.map