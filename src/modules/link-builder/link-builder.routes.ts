import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { linkBuilderController } from "./link-builder.controller";

const router = Router();

// view_link_builder / manage_link_builder (Online Booking Channels ticket,
// manage_booking split follow-up) — these routes had no permission check at
// all before, only role. manage_link_builder is a genuinely new gate, not a
// replacement for anything that previously existed.
router.post(
    "/generate",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("manage_link_builder"),
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
    requirePermission("manage_link_builder"),
    linkBuilderController.save
);

router.delete(
    "/saved/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    requirePermission("manage_link_builder"),
    linkBuilderController.deleteSaved
);

export default router;
