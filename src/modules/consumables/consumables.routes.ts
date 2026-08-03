import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { consumablesController } from "./consumables.controller";
import { validateConsumableUsage, validateConsumableUsageHistory } from "./consumables.validator";

const router = Router();

router.get(
  "/usage",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  requirePermission("view_inventory"),
  validateConsumableUsageHistory,
  consumablesController.history,
);

router.post(
  "/usage",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  requirePermission("view_inventory"),
  validateConsumableUsage,
  consumablesController.usage,
);

export default router;
