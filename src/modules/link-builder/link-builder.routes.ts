import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { linkBuilderController } from "./link-builder.controller";

const router = Router();

// view_link_builder / manage_link_builder (Online Booking Channels ticket,
// manage_booking split follow-up) — these routes had no permission check at
// all before, only role. manage_link_builder is a genuinely new gate, not a
// replacement for anything that previously existed.
// /generate only builds a booking URL from the salon's own slug — it saves
// nothing (saving/deleting stay behind manage_link_builder below). The
// Marketplace profile page calls it on load to show the salon's real booking
// link, so a role with Manage/View Marketplace but not Manage Link Builder was
// getting a 403 "manage_link_builder" popup just for opening Marketplace.
router.post(
    "/generate",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requireAnyPermission(["manage_link_builder", "manage_marketplace", "view_marketplace"]),
    linkBuilderController.generate
);

router.get(
    "/saved",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("view_link_builder"),
    linkBuilderController.listSaved
);

router.post(
    "/saved",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("view_link_builder"),
    requirePermission("manage_link_builder"),
    linkBuilderController.save
);

router.delete(
    "/saved/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("view_link_builder"),
    requirePermission("manage_link_builder"),
    linkBuilderController.deleteSaved
);

export default router;
