import { Router } from "express"
import { subscriptionsController } from "./subscriptions.controller"
import { authMiddleware } from "../../middleware/auth.middleware"
import { validateStartTrial } from "./subscriptions.validator"

const router = Router()

// ─── Plans ────────────────────────────────────────────────────
router.get("/plans", subscriptionsController.listPlans)
router.get("/plans/:id", subscriptionsController.getPlan)

// ─── Trial ────────────────────────────────────────────────────
router.post("/trial", authMiddleware, validateStartTrial, subscriptionsController.startTrial)
router.get("/trial/:salonId", authMiddleware, subscriptionsController.getTrialStatus)

// ─── Subscriptions (read-only) ────────────────────────────────
router.get("/salon/:salonId", authMiddleware, subscriptionsController.getSubscriptionsBySalon)
router.get("/:id", authMiddleware, subscriptionsController.getSubscription)
router.get("/:id/payments", authMiddleware, subscriptionsController.getPayments)

export default router
