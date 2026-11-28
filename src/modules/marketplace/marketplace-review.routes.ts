import { Router } from "express";
import { marketplaceReviewController } from "./onboarding.controller";

// Mounted inside the Super Admin router, which already requires a signed-in Super Admin and logs changes.
const router = Router();

router.get("/",                    marketplaceReviewController.list);
router.get("/:salonId",            marketplaceReviewController.detail);
router.get("/:salonId/preview",    marketplaceReviewController.preview);
router.post("/:salonId/approve",   marketplaceReviewController.approve);
router.post("/:salonId/reject",    marketplaceReviewController.reject);

export default router;
