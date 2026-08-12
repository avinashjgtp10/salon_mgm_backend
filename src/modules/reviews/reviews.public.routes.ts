import { Router } from "express";
import { reviewsPublicController } from "./reviews.public.controller";

const router = Router();

// No authMiddleware — deep-linked from a WhatsApp review_request button, the
// client has no account. Mounted at its own /api/v1/feedback base in app.ts,
// deliberately not nested under the authed /api/v1/reviews router.
router.get("/context/:slug", reviewsPublicController.getContext);
router.post("/submit/:slug", reviewsPublicController.submit);

export default router;
