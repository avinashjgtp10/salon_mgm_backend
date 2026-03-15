"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const billing_repository_1 = require("./billing.repository");
exports.billingService = {
    // ── Plans ─────────────────────────────────────────────────────────────────
    async listPlans() {
        return billing_repository_1.billingPlansRepository.findAll();
    },
    async getPlanById(id) {
        const plan = await billing_repository_1.billingPlansRepository.findById(id);
        if (!plan)
            throw new error_middleware_1.AppError(404, "Billing plan not found", "NOT_FOUND");
        return plan;
    },
    // ── Current Subscription ─────────────────────────────────────────────────
    async getSubscription(salonId) {
        return billing_repository_1.billingSubscriptionsRepository.findBySalonId(salonId);
    },
    // ── Subscribe (triggered by "Enable" button) ──────────────────────────────
    async subscribe(params) {
        const { requesterUserId, body } = params;
        logger_1.default.info("billingService.subscribe", {
            requesterUserId,
            salonId: body.salon_id,
            planId: body.plan_id,
            quantity: body.quantity,
        });
        const plan = await billing_repository_1.billingPlansRepository.findById(body.plan_id);
        if (!plan)
            throw new error_middleware_1.AppError(404, "Billing plan not found", "NOT_FOUND");
        if (!plan.is_active)
            throw new error_middleware_1.AppError(400, "This billing plan is not currently available", "PLAN_INACTIVE");
        // prevent duplicate active subscription
        const existing = await billing_repository_1.billingSubscriptionsRepository.findActiveBySalonId(body.salon_id);
        if (existing) {
            throw new error_middleware_1.AppError(409, "Salon already has an active billing subscription. Update or cancel it first.", "ALREADY_SUBSCRIBED");
        }
        const subscription = await billing_repository_1.billingSubscriptionsRepository.create(body, plan, requesterUserId);
        logger_1.default.info("billingService.subscribe success", {
            subscriptionId: subscription.id,
            status: subscription.status,
            total: subscription.total_amount,
            trialEndsAt: subscription.trial_ends_at,
        });
        return subscription;
    },
    // ── Update (change card / billing details / quantity) ─────────────────────
    async updateSubscription(params) {
        const { subscriptionId, requesterUserId, patch } = params;
        logger_1.default.info("billingService.updateSubscription", { subscriptionId, requesterUserId });
        const existing = await billing_repository_1.billingSubscriptionsRepository.findById(subscriptionId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Billing subscription not found", "NOT_FOUND");
        if (existing.status === "cancelled")
            throw new error_middleware_1.AppError(400, "Cannot update a cancelled subscription", "INVALID_STATUS");
        // fetch plan only if quantity is being updated (to recalculate total)
        let plan;
        if (patch.quantity !== undefined) {
            const fetched = await billing_repository_1.billingPlansRepository.findById(existing.plan_id);
            if (fetched)
                plan = fetched;
        }
        const updated = await billing_repository_1.billingSubscriptionsRepository.update(subscriptionId, patch, plan);
        logger_1.default.info("billingService.updateSubscription success", { subscriptionId: updated.id });
        return updated;
    },
    // ── Cancel ────────────────────────────────────────────────────────────────
    async cancelSubscription(params) {
        const { subscriptionId, requesterUserId, body } = params;
        logger_1.default.info("billingService.cancelSubscription", { subscriptionId, requesterUserId });
        const existing = await billing_repository_1.billingSubscriptionsRepository.findById(subscriptionId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Billing subscription not found", "NOT_FOUND");
        if (existing.status === "cancelled")
            throw new error_middleware_1.AppError(400, "Subscription is already cancelled", "INVALID_STATUS");
        const cancelled = await billing_repository_1.billingSubscriptionsRepository.cancel(subscriptionId, body.reason);
        logger_1.default.info("billingService.cancelSubscription success", { subscriptionId });
        return cancelled;
    },
    // ── Invoices ──────────────────────────────────────────────────────────────
    async listInvoices(filters) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const { data, total } = await billing_repository_1.billingInvoicesRepository.list({ ...filters, page, limit });
        return { data, total, page, limit };
    },
    async getInvoice(id) {
        const invoice = await billing_repository_1.billingInvoicesRepository.findById(id);
        if (!invoice)
            throw new error_middleware_1.AppError(404, "Invoice not found", "NOT_FOUND");
        return invoice;
    },
};
//# sourceMappingURL=billing.service.js.map