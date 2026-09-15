import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { digitalMenuController } from "./digital-menu.controller";
import { validateSaveDigitalMenu } from "./digital-menu.validator";

const router = Router();
const authBase = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];
const viewDigitalMenu = requirePermission("view_digital_menu");
const createDigitalMenu = requirePermission("create_digital_menu");
const editDigitalMenu = requirePermission("edit_digital_menu");

// ─── Public — no auth, matches bookings.routes.ts's "no auth middleware
// attached at all" pattern. Must stay ahead of nothing here since it's the
// only route on this path segment, but kept visually separate from the
// owner-authenticated routes below so it's never accidentally wrapped in
// authBase during a future edit. ──────────────────────────────────────────────
router.get("/public/:token", digitalMenuController.getPublic);

// ─── Owner-side CRUD ────────────────────────────────────────────────────────
router.get("/",   ...authBase, viewDigitalMenu, digitalMenuController.get);
router.post("/",  ...authBase, createDigitalMenu, validateSaveDigitalMenu, digitalMenuController.create);
router.patch("/:id", ...authBase, editDigitalMenu, validateSaveDigitalMenu, digitalMenuController.update);

export default router;
