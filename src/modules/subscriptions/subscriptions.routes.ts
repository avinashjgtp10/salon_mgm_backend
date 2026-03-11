import { Router } from "express"
import { subscriptionsController } from "./subscriptions.controller"
import { authMiddleware } from "../../middleware/auth.middleware"
import { roleMiddleware } from "../../middleware/role.middleware"
import {
    validateCreatePlan,
    validateCreateSubscription,
    validateStartTrial,
} from "./subscriptions.validator"

const router = Router()

// ─── Webhook (NO auth) ────────────────────────────────────────
router.post("/webhook", subscriptionsController.webhook)

// ─── Plans ────────────────────────────────────────────────────
router.post("/plans", authMiddleware, roleMiddleware("salon_owner", "admin"), validateCreatePlan, subscriptionsController.createPlan)
router.get("/plans", subscriptionsController.listPlans)
router.get("/plans/:id", subscriptionsController.getPlan)

// ─── Trial ────────────────────────────────────────────────────
router.post("/trial", authMiddleware, validateStartTrial, subscriptionsController.startTrial)
router.get("/trial/:salonId", authMiddleware, subscriptionsController.getTrialStatus)

// ─── Subscriptions ────────────────────────────────────────────
router.post("/", authMiddleware, validateCreateSubscription, subscriptionsController.createSubscription)
router.get("/salon/:salonId", authMiddleware, subscriptionsController.getSubscriptionsBySalon)
router.get("/:id", authMiddleware, subscriptionsController.getSubscription)
router.post("/:id/cancel", authMiddleware, subscriptionsController.cancelSubscription)
router.get("/:id/payments", authMiddleware, subscriptionsController.getPayments)

export default router
