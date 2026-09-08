import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { rolesController } from "./roles.controller";

const router = Router();
const auth = authMiddleware;
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
const viewRoles = requirePermission("view_roles");
const manageRoles = requirePermission("manage_roles");

router.get("/", auth, ownerAdminStaff, viewRoles, rolesController.list);
router.post("/", auth, ownerAdminStaff, manageRoles, rolesController.create);
router.get("/:id", auth, ownerAdminStaff, viewRoles, rolesController.getById);
router.patch("/:id", auth, ownerAdminStaff, manageRoles, rolesController.update);
router.delete("/:id", auth, ownerAdminStaff, manageRoles, rolesController.remove);
router.post("/:id/duplicate", auth, ownerAdminStaff, manageRoles, rolesController.duplicate);

export default router;
