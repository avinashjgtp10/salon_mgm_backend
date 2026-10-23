import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { aiAssistantController } from "./ai-assistant.controller";
import { validateChat, validateCampaign } from "./ai-assistant.validator";
import { SERVICE_VIEW_PERMS } from "./tools";

const router = Router();

// Owners/admins pass requirePermission automatically; staff need the
// use_ai_assistant grant (Migration/add_ai_assistant.sql).
router.post(
    "/chat",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    validateChat,
    aiAssistantController.chat
);

// Same "can see services" gate the Services list uses; deliberately not view_products —
// a receptionist at checkout should get upsell ideas without Inventory access.
router.post(
    "/recommend-products",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requireAnyPermission(SERVICE_VIEW_PERMS),
    aiAssistantController.recommendProducts
);

// Poster maker: creates marketing content, so it needs a marketing permission on top of AI access.
const MARKETING_PERMS = ["view_marketing_dashboard", "view_templates"];

router.post(
    "/campaign",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requireAnyPermission(MARKETING_PERMS),
    validateCampaign,
    aiAssistantController.campaign
);

router.get(
    "/campaigns",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requireAnyPermission(MARKETING_PERMS),
    aiAssistantController.campaigns
);

// Marketing helpers — each also needs the permission for the screen it lives on.
router.post(
    "/template-copy",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requireAnyPermission(["add_template", "view_templates"]),
    aiAssistantController.templateCopy
);

router.post(
    "/campaign-insights",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requireAnyPermission(["view_campaigns", "view_marketing_dashboard"]),
    aiAssistantController.campaignInsights
);

// Drafts only — the staff member edits and presses Send in the Inbox themselves.
router.post(
    "/inbox-replies",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requirePermission("reply_to_conversation"),
    aiAssistantController.inboxReplies
);

// Dashboard "Ask your data": read-only questions about the salon's numbers. Each tool inside also checks the
// matching report permission, so a user can never read data through the AI that they couldn't open themselves.
router.post(
    "/ask-data",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    requirePermission("view_dashboard"),
    validateChat,
    aiAssistantController.askData
);

// "Explain with LUNOX" on a report page. Needs the report's own permission on top of AI access (add one route per report).
router.post(
    "/report-insights",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("use_ai_assistant"),
    // the report's own permission is checked in the controller, because it depends on which report is asked for
    aiAssistantController.reportInsights
);

export default router;
