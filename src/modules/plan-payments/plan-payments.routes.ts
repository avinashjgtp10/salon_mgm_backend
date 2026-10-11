import { Router, Request } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { planPaymentsController } from "./plan-payments.controller";

// The webhook is NOT here: it needs the raw request body, so app.ts mounts it
// before express.json(). See planPaymentsController.webhook.

const router = Router();

// Per logged-in user (not per IP — many salons share a proxy/NAT address).
const paymentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: Request) => (req as Request & { user?: { userId?: string } }).user?.userId ?? "anonymous",
    message: { success: false, error: { code: "RATE_LIMITED", message: "Too many payment attempts. Please try again in a few minutes." } },
});

router.post("/checkout", authMiddleware, roleMiddleware("salon_owner"), paymentLimiter, planPaymentsController.createCheckout);
router.post("/verify",   authMiddleware, roleMiddleware("salon_owner"), paymentLimiter, planPaymentsController.verify);

export default router;
