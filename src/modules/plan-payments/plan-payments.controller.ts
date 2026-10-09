import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { planPaymentsService } from "./plan-payments.service";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

// The user and salon always come from the JWT, never from the request body.
// salonId is null for a brand-new account that has not finished onboarding
// yet (its salon is created at the end) — it can still pay; the plan is
// applied to the salon when it is created.
function requireUser(req: AuthRequest): { salonId: string | null; userId: string } {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    return { salonId: req.user?.salonId ?? null, userId };
}

export const planPaymentsController = {

    // POST /api/v1/plan-payments/checkout   { tier, cycle }
    async createCheckout(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { salonId, userId } = requireUser(req);
            const data = await planPaymentsService.createCheckout({
                salonId, userId, tier: req.body?.tier, cycle: req.body?.cycle,
            });
            return sendSuccess(res, 201, data, "Order created");
        } catch (err) { return next(err); }
    },

    // POST /api/v1/plan-payments/verify   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
    async verify(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { userId } = requireUser(req);
            const data = await planPaymentsService.verifyPayment({
                userId,
                orderId: req.body?.razorpay_order_id,
                paymentId: req.body?.razorpay_payment_id,
                signature: req.body?.razorpay_signature,
            });
            return sendSuccess(res, 200, data, "Payment verified and plan activated");
        } catch (err) { return next(err); }
    },

    // POST /api/v1/plan-payments/webhook — mounted in app.ts with express.raw()
    // BEFORE express.json(): the signature is over the exact bytes Razorpay
    // sent, so a parsed-then-re-serialised body cannot be trusted to match.
    async webhook(req: Request, res: Response, next: NextFunction) {
        try {
            const signature = req.header("x-razorpay-signature");
            const raw = req.body as Buffer;
            if (!signature || !Buffer.isBuffer(raw)) {
                throw new AppError(400, "Invalid webhook request", "VALIDATION_ERROR");
            }
            if (!planPaymentsService.verifyWebhookSignature(raw, signature)) {
                logger.warn("planPayments webhook: bad signature");
                throw new AppError(400, "Invalid webhook signature", "INVALID_SIGNATURE");
            }

            let event: unknown;
            try {
                event = JSON.parse(raw.toString("utf8"));
            } catch {
                throw new AppError(400, "Invalid webhook body", "VALIDATION_ERROR");
            }

            // Razorpay always sends x-razorpay-event-id; hash the body as a
            // stable fallback so de-dupe still works if it is ever missing.
            const eventId = req.header("x-razorpay-event-id") ?? `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`;
            await planPaymentsService.handleWebhook(eventId, event);
            return res.status(200).json({ received: true });
        } catch (err) { return next(err); }
    },
};
