import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { packageTemplatesController } from "./package-templates.controller";
import { validateCreatePackageTemplate, validateUpdatePackageTemplate } from "./package-templates.validator";

const router = Router();
// Previously only [authMiddleware, requireSalon] — same gap as
// client-packages.routes.ts, closed the same way (these are the sellable
// package templates, adjacent to the client-purchase-history tables).
const auth = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
const viewPackages = requirePermission("view_packages");
const createPackages = requirePermission("create_packages");
const editPackages = requirePermission("edit_packages");
const deletePackages = requirePermission("delete_packages");

router.get("/",       ...auth, viewPackages, packageTemplatesController.list);
router.post("/",      ...auth, createPackages, validateCreatePackageTemplate, packageTemplatesController.create);
router.get("/:id",    ...auth, viewPackages, packageTemplatesController.getById);
router.patch("/:id",  ...auth, editPackages, validateUpdatePackageTemplate, packageTemplatesController.update);
router.delete("/:id", ...auth, deletePackages, packageTemplatesController.delete);

export default router;
