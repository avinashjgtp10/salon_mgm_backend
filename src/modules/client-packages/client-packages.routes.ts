import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { clientPackagesController } from "./client-packages.controller";
import {
  validateCreateClientPackage,
  validateCompleteSession,
} from "./client-packages.validator";

const router = Router();
// Previously only [authMiddleware, requireSalon] — any authenticated user
// tied to a salon could list/create/edit/delete any client's purchased
// packages regardless of role or permission. Added the same role gate every
// other client-facing module uses, plus a dedicated permission check.
const auth = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
const managePurchaseHistory = requirePermission("manage_client_purchase_history");

router.get("/",      ...auth, managePurchaseHistory, clientPackagesController.list);
router.post("/",     ...auth, managePurchaseHistory, validateCreateClientPackage, clientPackagesController.create);
router.get("/:id",    ...auth, managePurchaseHistory, clientPackagesController.getById);
router.patch("/:id",  ...auth, managePurchaseHistory, clientPackagesController.update);
router.delete("/:id", ...auth, managePurchaseHistory, clientPackagesController.delete);
router.post("/:id/sessions/complete", ...auth, managePurchaseHistory, validateCompleteSession, clientPackagesController.completeSession);

export default router;
