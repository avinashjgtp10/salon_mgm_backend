"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const billing_controller_1 = require("./billing.controller");
const billing_validator_1 = require("./billing.validator");
const router = (0, express_1.Router)();
// ─── Plans (read-only) ────────────────────────────────────────────────────────
router.get("/plans", auth_middleware_1.authMiddleware, billing_controller_1.billingController.listPlans);
router.get("/plans/:id", auth_middleware_1.authMiddleware, billing_controller_1.billingController.getPlanById);
// ─── Salon Billing Subscription ───────────────────────────────────────────────
// GET current subscription for a salon
router.get("/subscription", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), billing_controller_1.billingController.getSubscription);
// POST — "Enable" button submits here
router.post("/subscribe", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), billing_validator_1.validateSubscribeBilling, billing_controller_1.billingController.subscribe);
// PATCH — update card or billing details
router.patch("/subscription/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), billing_validator_1.validateUpdateBillingSubscription, billing_controller_1.billingController.updateSubscription);
// POST — cancel subscription
router.post("/subscription/:id/cancel", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), billing_controller_1.billingController.cancelSubscription);
// ─── Invoices ─────────────────────────────────────────────────────────────────
router.get("/invoices", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), billing_controller_1.billingController.listInvoices);
router.get("/invoices/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), billing_controller_1.billingController.getInvoice);
exports.default = router;
//# sourceMappingURL=billing.routes.js.map