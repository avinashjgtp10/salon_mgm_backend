import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { settingsController } from "./settings.controller";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
const generalSettings = requirePermission("general_settings");

// Reads stay open to any authenticated salon staff (other features, e.g. Quick
// Sale, read shared config like tax rates from here) — only writes require the
// general_settings permission, since those can change salon-wide behavior.
router.get("/",      authMiddleware, ownerAdminStaff, settingsController.list);
router.get("/:id",   authMiddleware, ownerAdminStaff, settingsController.getById);
router.post("/",     authMiddleware, ownerAdminStaff, generalSettings, settingsController.create);
router.put("/:id",   authMiddleware, ownerAdminStaff, generalSettings, settingsController.update);
router.delete("/:id",authMiddleware, ownerAdminStaff, generalSettings, settingsController.remove);

export default router;
