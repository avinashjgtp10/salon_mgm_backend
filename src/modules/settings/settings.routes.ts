import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { settingsController } from "./settings.controller";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

// Reads stay open to any authenticated salon staff (other features, e.g. Quick
// Sale, read shared config like tax rates from here) — no permission key,
// unchanged.
//
// Writes: the blanket general_settings permission that used to gate every
// write here regardless of which settings `key` was being touched has been
// removed entirely (not kept as a fallback) — assertCanWriteKey() in
// settings.controller.ts now maps each known key to its own
// view_settings_<section> permission from the Settings sections ticket, and
// denies by default for anything it doesn't recognize (previously an
// unrecognized/unaudited key would still get through on general_settings
// alone). See that function for the full key → permission table, including
// why role_permissions/subscription_permissions get their own stricter
// handling instead of falling through to the default.
router.get("/",      authMiddleware, ownerAdminStaff, settingsController.list);
router.get("/:id",   authMiddleware, ownerAdminStaff, settingsController.getById);
router.post("/",     authMiddleware, ownerAdminStaff, settingsController.create);
router.put("/:id",   authMiddleware, ownerAdminStaff, settingsController.update);
router.delete("/:id",authMiddleware, ownerAdminStaff, settingsController.remove);

export default router;
