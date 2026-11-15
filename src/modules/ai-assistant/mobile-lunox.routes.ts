import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireMobileApp } from "../../middleware/mobileApp.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { aiAssistantController } from "./ai-assistant.controller";

// LUNOX features that exist only in the mobile app (mounted at /api/v1/mobile/lunox).
const router = Router();

// Dashboard "AI insight" card: one short data-backed tip a day, built by the same read-only data assistant (and the
// same permission checks) as "Ask your data", cached per salon per day. Mobile-app sessions only.
router.get(
    "/daily-insight",
    authMiddleware,
    requireMobileApp,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requirePermission("view_dashboard"),
    aiAssistantController.dailyInsight
);

export default router;
