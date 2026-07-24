import { Router } from "express"
import { subscriptionsController } from "./subscriptions.controller"
import { authMiddleware } from "../../middleware/auth.middleware"
import { roleMiddleware } from "../../middleware/role.middleware"
import { requireSubscriptionPermission } from "../../middleware/subscriptionPermission.middleware"
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

// ─── Verify (called after Razorpay redirect — no webhook needed locally) ─────
router.post("/verify/:salonId", authMiddleware, subscriptionsController.verifySubscription)

// ─── Subscriptions ────────────────────────────────────────────
// Renew/Upgrade/Downgrade all funnel through this one endpoint — this
// codebase has no separate route per action. All three permissions are
// checked; since a super admin normally toggles them together for one
// account, this is equivalent to gating "this account's ability to change
// its plan" as a whole until distinct renew/upgrade/downgrade flows exist.
router.post(
    "/",
    authMiddleware,
    requireSubscriptionPermission("renew_subscription"),
    requireSubscriptionPermission("upgrade_subscription"),
    requireSubscriptionPermission("downgrade_subscription"),
    validateCreateSubscription,
    subscriptionsController.createSubscription
)
router.get("/salon/:salonId", authMiddleware, subscriptionsController.getSubscriptionsBySalon)
router.get("/:id", authMiddleware, subscriptionsController.getSubscription)
router.post("/:id/cancel", authMiddleware, subscriptionsController.cancelSubscription)
router.get("/:id/payments", authMiddleware, subscriptionsController.getPayments)

export default router