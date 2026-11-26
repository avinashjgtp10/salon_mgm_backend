import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { billingController } from "./billing.controller";
import {
    validateSubscribeBilling,
    validateUpdateBillingSubscription,
} from "./billing.validator";
import { billingService } from "./billing.service";
import { billingSubscriptionsRepository } from "./billing.repository";
import { assertSalonAccess, canAccessSalon } from "../../middleware/salon-access";
import { AppError } from "../../middleware/error.middleware";

const router = Router();

// Being a salon owner is not enough: the salon (or the record's salon) must be the caller's own. A record that belongs to
// someone else answers "not found", so ids can't be probed.
const ownSalon = (salonIdOf: (req: any) => unknown) => async (req: any, _res: any, next: any) => {
    try {
        await assertSalonAccess(req.user, salonIdOf(req), { ownerOnly: true });
        next();
    } catch (err) { next(err); }
};
const ownRecord = (load: (id: string) => Promise<{ salon_id?: string | null }>) => async (req: any, _res: any, next: any) => {
    try {
        const record = await load(String(req.params.id));
        if (!(await canAccessSalon(req.user, record.salon_id, { ownerOnly: true }))) throw new AppError(404, "Not found", "NOT_FOUND");
        next();
    } catch (err) { next(err); }
};
const subscriptionRecord = ownRecord(async (id) => {
    const row = await billingSubscriptionsRepository.findById(id);
    if (!row) throw new AppError(404, "Billing subscription not found", "NOT_FOUND");
    return row;
});

// /subscribe records a subscription without taking any payment. A salon may only use it for a plan that begins with a free
// trial, once; being active without paying goes through checkout instead.
const trialOnly = async (req: any, _res: any, next: any) => {
    try {
        const plan: any = await billingService.getPlanById(String(req.body.plan_id));
        const hasTrial = Number(plan.trial_days ?? 0) > 0 || Number(plan.trial_minutes ?? 0) > 0;
        if (!hasTrial || (await billingSubscriptionsRepository.findBySalonId(String(req.body.salon_id)))) {
            throw new AppError(402, "Choose a plan and complete the payment to subscribe.", "PAYMENT_REQUIRED");
        }
        next();
    } catch (err) { next(err); }
};

// ─── Plans (read-only) ────────────────────────────────────────────────────────
router.get("/plans", authMiddleware, billingController.listPlans);
router.get("/plans/:id", authMiddleware, billingController.getPlanById);

// ─── Salon Billing Subscription ───────────────────────────────────────────────

// GET current subscription for a salon
router.get(
    "/subscription",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    billingController.getSubscription
);

// POST — "Enable" button submits here
router.post(
    "/subscribe",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateSubscribeBilling,
    ownSalon((req) => req.body.salon_id),
    trialOnly,
    billingController.subscribe
);

// PATCH — update card or billing details
router.patch(
    "/subscription/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateBillingSubscription,
    subscriptionRecord,
    billingController.updateSubscription
);

// POST — cancel subscription
router.post(
    "/subscription/:id/cancel",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    subscriptionRecord,
    billingController.cancelSubscription
);

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.get(
    "/invoices",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    billingController.listInvoices
);

router.get(
    "/invoices/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    ownRecord((id) => billingService.getInvoice(id)),
    billingController.getInvoice
);

export default router;
