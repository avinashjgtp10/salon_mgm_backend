import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import {
    billingPlansRepository,
    billingSubscriptionsRepository,
    billingInvoicesRepository,
} from "./billing.repository";
import {
    BillingPlan,
    BillingSubscription,
    BillingInvoice,
    SubscribeBillingBody,
    UpdateBillingSubscriptionBody,
    CancelBillingSubscriptionBody,
    ListBillingInvoicesFilters,
} from "./billing.types";

export const billingService = {

    // ── Plans ─────────────────────────────────────────────────────────────────

    async listPlans(): Promise<BillingPlan[]> {
        return billingPlansRepository.findAll();
    },

    async getPlanById(id: string): Promise<BillingPlan> {
        const plan = await billingPlansRepository.findById(id);
        if (!plan) throw new AppError(404, "Billing plan not found", "NOT_FOUND");
        return plan;
    },

    // ── Current Subscription ─────────────────────────────────────────────────

    async getSubscription(salonId: string): Promise<BillingSubscription | null> {
        return billingSubscriptionsRepository.findBySalonId(salonId);
    },

    // ── Subscribe (triggered by "Enable" button) ──────────────────────────────

    async subscribe(params: {
        requesterUserId: string;
        body: SubscribeBillingBody;
    }): Promise<BillingSubscription> {
        const { requesterUserId, body } = params;

        logger.info("billingService.subscribe", {
            requesterUserId,
            salonId: body.salon_id,
            planId: body.plan_id,
            quantity: body.quantity,
        });

        const plan = await billingPlansRepository.findById(body.plan_id);
        if (!plan) throw new AppError(404, "Billing plan not found", "NOT_FOUND");
        if (!plan.is_active) throw new AppError(400, "This billing plan is not currently available", "PLAN_INACTIVE");

        // prevent duplicate active subscription
        const existing = await billingSubscriptionsRepository.findActiveBySalonId(body.salon_id);
        if (existing) {
            throw new AppError(
                409,
                "Salon already has an active billing subscription. Update or cancel it first.",
                "ALREADY_SUBSCRIBED"
            );
        }

        const subscription = await billingSubscriptionsRepository.create(body, plan, requesterUserId);

        logger.info("billingService.subscribe success", {
            subscriptionId: subscription.id,
            status: subscription.status,
            total: subscription.total_amount,
            trialEndsAt: subscription.trial_ends_at,
        });

        return subscription;
    },

    // ── Update (change card / billing details / quantity) ─────────────────────

    async updateSubscription(params: {
        subscriptionId: string;
        requesterUserId: string;
        patch: UpdateBillingSubscriptionBody;
    }): Promise<BillingSubscription> {
        const { subscriptionId, requesterUserId, patch } = params;

        logger.info("billingService.updateSubscription", { subscriptionId, requesterUserId });

        const existing = await billingSubscriptionsRepository.findById(subscriptionId);
        if (!existing) throw new AppError(404, "Billing subscription not found", "NOT_FOUND");
        if (existing.status === "cancelled")
            throw new AppError(400, "Cannot update a cancelled subscription", "INVALID_STATUS");

        // fetch plan only if quantity is being updated (to recalculate total)
        let plan: BillingPlan | undefined;
        if (patch.quantity !== undefined) {
            const fetched = await billingPlansRepository.findById(existing.plan_id);
            if (fetched) plan = fetched;
        }

        const updated = await billingSubscriptionsRepository.update(subscriptionId, patch, plan);

        logger.info("billingService.updateSubscription success", { subscriptionId: updated.id });

        return updated;
    },

    // ── Cancel ────────────────────────────────────────────────────────────────

    async cancelSubscription(params: {
        subscriptionId: string;
        requesterUserId: string;
        body: CancelBillingSubscriptionBody;
    }): Promise<BillingSubscription> {
        const { subscriptionId, requesterUserId, body } = params;

        logger.info("billingService.cancelSubscription", { subscriptionId, requesterUserId });

        const existing = await billingSubscriptionsRepository.findById(subscriptionId);
        if (!existing) throw new AppError(404, "Billing subscription not found", "NOT_FOUND");
        if (existing.status === "cancelled")
            throw new AppError(400, "Subscription is already cancelled", "INVALID_STATUS");

        const cancelled = await billingSubscriptionsRepository.cancel(subscriptionId, body.reason);

        logger.info("billingService.cancelSubscription success", { subscriptionId });

        return cancelled;
    },

    // ── Invoices ──────────────────────────────────────────────────────────────

    async listInvoices(
        filters: ListBillingInvoicesFilters
    ): Promise<{ data: BillingInvoice[]; total: number; page: number; limit: number }> {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const { data, total } = await billingInvoicesRepository.list({ ...filters, page, limit });
        return { data, total, page, limit };
    },

    async getInvoice(id: string): Promise<BillingInvoice> {
        const invoice = await billingInvoicesRepository.findById(id);
        if (!invoice) throw new AppError(404, "Invoice not found", "NOT_FOUND");
        return invoice;
    },
};
