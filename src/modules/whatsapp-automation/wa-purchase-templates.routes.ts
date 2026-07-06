import { Router } from "express";
import { waPurchaseTemplatesController } from "./wa-purchase-templates.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";

const router = Router();

router.use(authMiddleware);
router.use(roleMiddleware("salon_owner", "admin"));

// GET /api/v1/wa-automation/purchase-templates/:salonId
router.get("/:salonId", waPurchaseTemplatesController.list);
// PATCH /api/v1/wa-automation/purchase-templates/:salonId/:eventType  body: { body_text }
router.patch("/:salonId/:eventType", waPurchaseTemplatesController.updateWording);
// POST /api/v1/wa-automation/purchase-templates/:salonId/:eventType/submit
router.post("/:salonId/:eventType/submit", waPurchaseTemplatesController.submitForApproval);
// POST /api/v1/wa-automation/purchase-templates/:salonId/:eventType/sync
router.post("/:salonId/:eventType/sync", waPurchaseTemplatesController.syncStatus);

export default router;
