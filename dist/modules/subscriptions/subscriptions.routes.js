"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const subscriptions_controller_1 = require("./subscriptions.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const subscriptions_validator_1 = require("./subscriptions.validator");
const router = (0, express_1.Router)();
// ─── Webhook (NO auth) ────────────────────────────────────────
router.post("/webhook", subscriptions_controller_1.subscriptionsController.webhook);
// ─── Plans ────────────────────────────────────────────────────
router.post("/plans", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), subscriptions_validator_1.validateCreatePlan, subscriptions_controller_1.subscriptionsController.createPlan);
router.get("/plans", subscriptions_controller_1.subscriptionsController.listPlans);
router.get("/plans/:id", subscriptions_controller_1.subscriptionsController.getPlan);
// ─── Trial ────────────────────────────────────────────────────
router.post("/trial", auth_middleware_1.authMiddleware, subscriptions_validator_1.validateStartTrial, subscriptions_controller_1.subscriptionsController.startTrial);
router.get("/trial/:salonId", auth_middleware_1.authMiddleware, subscriptions_controller_1.subscriptionsController.getTrialStatus);
// ─── Subscriptions ────────────────────────────────────────────
router.post("/", auth_middleware_1.authMiddleware, subscriptions_validator_1.validateCreateSubscription, subscriptions_controller_1.subscriptionsController.createSubscription);
router.get("/salon/:salonId", auth_middleware_1.authMiddleware, subscriptions_controller_1.subscriptionsController.getSubscriptionsBySalon);
router.get("/:id", auth_middleware_1.authMiddleware, subscriptions_controller_1.subscriptionsController.getSubscription);
router.post("/:id/cancel", auth_middleware_1.authMiddleware, subscriptions_controller_1.subscriptionsController.cancelSubscription);
router.get("/:id/payments", auth_middleware_1.authMiddleware, subscriptions_controller_1.subscriptionsController.getPayments);
exports.default = router;
//# sourceMappingURL=subscriptions.routes.js.map