import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { billingController } from "./billing.controller";
import {
    validateSubscribeBilling,
    validateUpdateBillingSubscription,
} from "./billing.validator";

const router = Router();

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
    billingController.subscribe
);

// PATCH — update card or billing details
router.patch(
    "/subscription/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateBillingSubscription,
    billingController.updateSubscription
);

// POST — cancel subscription
router.post(
    "/subscription/:id/cancel",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    billingController.cancelSubscription
);

// ─── Razorpay ────────────────────────────────────────────────────────────────

// POST — create a Razorpay order (before showing checkout popup)
router.post(
    "/create-order",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    billingController.createOrder
);

// POST — verify payment signature and activate subscription
router.post(
    "/verify-payment",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    billingController.verifyPayment
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
    billingController.getInvoice
);

export default router;
