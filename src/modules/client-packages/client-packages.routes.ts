import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requireAnyPermission } from "../../middleware/permission.middleware";
import { clientPackagesController } from "./client-packages.controller";
import {
  validateCreateClientPackage,
  validateCompleteSession,
} from "./client-packages.validator";

const router = Router();
// Previously only [authMiddleware, requireSalon] — any authenticated user
// tied to a salon could list/create/edit/delete any client's purchased
// packages regardless of role or permission. Added the same role gate every
// other client-facing module uses. manage_client_purchase_history (a
// dedicated fine-grained permission for create/edit/delete/complete-session)
// was tried and then removed — these writes are role-only now (owner/admin/
// staff), same as most other Warehouse-adjacent actions in this app.
const auth = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
// Reads accept view_clients or view_appointment — Quick Sale/Calendar need
// to read a selected client's package coverage just to build a booking/sale
// or show it inside View Appointment, which is routine client-viewing.
const readPurchaseHistory = requireAnyPermission(["view_clients", "view_appointment"]);

router.get("/",      ...auth, readPurchaseHistory, clientPackagesController.list);
router.post("/",     ...auth, validateCreateClientPackage, clientPackagesController.create);
router.get("/:id",    ...auth, readPurchaseHistory, clientPackagesController.getById);
router.patch("/:id",  ...auth, clientPackagesController.update);
router.delete("/:id", ...auth, clientPackagesController.delete);
router.post("/:id/sessions/complete", ...auth, validateCompleteSession, clientPackagesController.completeSession);

export default router;
