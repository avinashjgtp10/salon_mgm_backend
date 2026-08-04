import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { superAdminMiddleware } from "../../middleware/role.middleware";
import { deploymentAnnouncementsController } from "./deployment-announcements.controller";

const router = Router();

// Any authenticated user (salon owner/staff) — polled by every dashboard to
// decide whether to show the deployment banner.
router.get("/active", authMiddleware, deploymentAnnouncementsController.getActive);

// Super Admin only — creating/stopping/reviewing announcements.
router.post("/", authMiddleware, superAdminMiddleware, deploymentAnnouncementsController.create);
router.post("/:id/stop", authMiddleware, superAdminMiddleware, deploymentAnnouncementsController.stop);
router.get("/recent", authMiddleware, superAdminMiddleware, deploymentAnnouncementsController.listRecent);

export default router;
