import { Router } from "express"
import { subscriptionsController } from "./subscriptions.controller"
import { authMiddleware } from "../../middleware/auth.middleware"
import { validateStartTrial } from "./subscriptions.validator"
import { planPricingService } from "../plan-pricing/plan-pricing.service"
import { subscriptionCheckoutService } from "./subscription-checkout.service"
import { subscriptionInvoicesService } from "../subscription-invoices/subscription-invoices.service"
import { getSalonId } from "../utils/salon.util"
import { AppError } from "../../middleware/error.middleware"
import { requireModule } from "../../middleware/moduleLock.middleware"
import logger from "../../config/logger"
import { subscriptionBillingService } from "../subscription-billing/subscription-billing.service"
import { subscriptionUpgradeService } from "../subscription-upgrade/subscription-upgrade.service"

const router = Router()

// ─── Plans ────────────────────────────────────────────────────
router.get("/plans", subscriptionsController.listPlans)
router.get("/plans/:id", subscriptionsController.getPlan)

// Public: Basic / Advance / Growth with their monthly + yearly amounts (set by Super Admin on the Plans page).
router.get("/catalog", async (_req, res, next) => {
    try {
        res.json({ success: true, data: await planPricingService.catalog() })
    } catch (err) { next(err) }
})

// Owner/admin starts paying for a plan: creates the Razorpay subscription and returns its hosted payment page.
router.post("/checkout", authMiddleware, async (req, res, next) => {
    try {
        const user = (req as any).user as { userId: string; role?: string } | undefined
        if (!user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED")
        // Right after registration there is no salon yet (onboarding creates it): that is allowed, the subscription
        // then belongs to the user and is attached to the salon when it is created. Once a salon exists, only its
        // owner/admin can change the plan.
        let salonId: string | null = null
        try {
            salonId = await getSalonId(req)
        } catch (err) {
            if (!(err instanceof AppError && err.code === "NO_SALON_CONTEXT")) throw err
        }
        if (salonId && user.role !== "salon_owner" && user.role !== "admin") {
            throw new AppError(403, "Only the salon owner can change the plan", "FORBIDDEN")
        }
        const data = await subscriptionCheckoutService.createCheckout(salonId, user.userId, req.body?.tier, req.body?.cycle)
        res.status(201).json({ success: true, data })
    } catch (err) { next(err) }
})

// Has the signed-in user paid for a plan? (polled by the post-registration plan page while they pay on Razorpay)
router.get("/my-status", authMiddleware, async (req, res, next) => {
    try {
        const user = (req as any).user as { userId: string } | undefined
        if (!user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED")
        res.json({ success: true, data: await subscriptionCheckoutService.paymentStatus(user.userId) })
    } catch (err) { next(err) }
})

// The salon's own subscription invoices (owner/admin only) and their PDFs. Always scoped to the caller's salon.
const ownerOnly = (req: any) => {
    const role = req.user?.role
    if (role !== "salon_owner" && role !== "admin") throw new AppError(403, "Only the salon owner can view invoices", "FORBIDDEN")
}
router.get("/invoices", authMiddleware, requireModule("billing_history"), async (req, res, next) => {
    try {
        ownerOnly(req)
        res.json({ success: true, data: await subscriptionInvoicesService.listForSalon(await getSalonId(req)) })
    } catch (err) { next(err) }
})
router.get("/invoices/:id/pdf", authMiddleware, requireModule("billing_history"), async (req, res, next) => {
    try {
        ownerOnly(req)
        const { pdf, filename } = await subscriptionInvoicesService.renderPdf(String(req.params.id), await getSalonId(req))
        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`)
        res.send(pdf)
    } catch (err) { next(err) }
})

// Billing & Plans: the salon's real current subscription (from its own rows + verified payments), its history, and upgrades.
// Every route is scoped to the caller's own salon; the salon id is never taken from the request.
const billingRoute = (fn: (salonId: string, req: any) => Promise<unknown>) => async (req: any, res: any, next: any) => {
    try {
        ownerOnly(req)
        res.json({ success: true, data: await fn(await getSalonId(req), req) })
    } catch (err) { next(err) }
}
router.get("/current", authMiddleware, requireModule("billing_plans"), billingRoute((salonId) => subscriptionBillingService.getCurrent(salonId)))
router.get("/billing-history", authMiddleware, requireModule("billing_history"), billingRoute((salonId) => subscriptionBillingService.getHistory(salonId)))
router.post("/upgrade/quote", authMiddleware, billingRoute((salonId, req) => subscriptionUpgradeService.quote(salonId, req.body?.tier, req.body?.cycle)))
router.post("/upgrade/initiate", authMiddleware, billingRoute((salonId, req) => subscriptionUpgradeService.initiate(salonId, req.user.userId, req.body?.tier, req.body?.cycle)))
router.post("/upgrade/:id/verify", authMiddleware, billingRoute((salonId, req) => subscriptionUpgradeService.verify(salonId, String(req.params.id), req.body ?? {}, req.user.userId)))
router.post("/upgrade/:id/cancel", authMiddleware, billingRoute((salonId, req) => subscriptionUpgradeService.cancel(salonId, String(req.params.id))))

// Razorpay -> us. Public (no auth); authenticity comes from the HMAC signature over the raw body.
router.post("/webhook", async (req, res) => {
    const raw = (req as any).rawBody as Buffer | undefined
    if (!subscriptionCheckoutService.verifySignature(raw, req.get("x-razorpay-signature"))) {
        logger.warn("Razorpay webhook rejected: invalid or missing signature", {
            requestId: (req as any).requestId,
            hasSignature: Boolean(req.get("x-razorpay-signature")),
            hasRawBody: Boolean(raw),
        })
        res.status(400).json({ success: false, error: { message: "Invalid signature" } })
        return
    }
    try {
        const result = await subscriptionCheckoutService.handleWebhook(req.body)
        logger.info("Razorpay webhook processed", { event: req.body?.event, result })
        res.json({ success: true, result })
    } catch (err: any) {
        logger.error("Razorpay webhook failed", { event: req.body?.event, error: err?.message })
        res.status(500).json({ success: false, error: { message: "Webhook processing failed" } })   // non-2xx => Razorpay retries
    }
})

// ─── Trial ────────────────────────────────────────────────────
router.post("/trial", authMiddleware, validateStartTrial, subscriptionsController.startTrial)
router.get("/trial/:salonId", authMiddleware, subscriptionsController.getTrialStatus)

// ─── Subscriptions (read-only) ────────────────────────────────
router.get("/salon/:salonId", authMiddleware, subscriptionsController.getSubscriptionsBySalon)
router.get("/:id", authMiddleware, subscriptionsController.getSubscription)
router.get("/:id/payments", authMiddleware, subscriptionsController.getPayments)

export default router
