import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { clientPackagesController } from "./client-packages.controller";
import {
  validateCreateClientPackage,
  validateCompleteSession,
} from "./client-packages.validator";

const router = Router();
// Previously only [authMiddleware, requireSalon] — any authenticated user
// tied to a salon could list/create/edit/delete any client's purchased
// packages regardless of role or permission. Added the same role gate every
// other client-facing module uses. A prior dedicated fine-grained
// manage_client_purchase_history permission was tried then removed — this
// ticket (Packages permissions) reintroduces real fine-grained gating with
// its own view_client_packages/create_package/edit_package/delete_package
// keys instead, closing the zero-gating gap for good this time.
const auth = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
// Reads accept view_clients or view_appointment (Quick Sale/Calendar need to
// read a selected client's package coverage just to build a booking/sale,
// or show it inside View Appointment) OR the new dedicated
// view_client_packages, for the Client Packages page itself.
const readPurchaseHistory = requireAnyPermission(["view_clients", "view_appointment", "view_client_packages"]);
const createPackage = requirePermission("create_package");
const editPackage = requirePermission("edit_package");
const deletePackage = requirePermission("delete_package");

router.get("/",      ...auth, readPurchaseHistory, clientPackagesController.list);
router.post("/",     ...auth, createPackage, validateCreateClientPackage, clientPackagesController.create);
router.get("/:id",    ...auth, readPurchaseHistory, clientPackagesController.getById);
router.patch("/:id",  ...auth, editPackage, clientPackagesController.update);
router.delete("/:id", ...auth, deletePackage, clientPackagesController.delete);
router.post("/:id/sessions/complete", ...auth, editPackage, validateCompleteSession, clientPackagesController.completeSession);

export default router;
