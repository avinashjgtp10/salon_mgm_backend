import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { requireAnyPermission } from "../../middleware/permission.middleware";
import { packageTemplatesController } from "./package-templates.controller";
import { validateCreatePackageTemplate, validateUpdatePackageTemplate } from "./package-templates.validator";

const router = Router();
// Previously only [authMiddleware, requireSalon] — same gap as
// client-packages.routes.ts, closed the same way (these are the sellable
// package templates, adjacent to the client-purchase-history tables).
const auth = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
// Package Templates now has its own dedicated View/Add/Edit/Delete
// permissions too (see the Packages permissions ticket), independent from
// the legacy Packages.tsx package-builder page's view_packages/
// create_packages/edit_packages/delete_packages (out of scope for that
// ticket) — OR'd in as alternatives so existing grants on the generic keys
// keep working unchanged.
const viewPackageTemplates = requireAnyPermission(["view_package_templates", "view_packages"]);
const addPackageTemplate = requireAnyPermission(["add_package_template", "create_packages"]);
const editPackageTemplate = requireAnyPermission(["edit_package_template", "edit_packages"]);
const deletePackageTemplate = requireAnyPermission(["delete_package_template", "delete_packages"]);

router.get("/",       ...auth, viewPackageTemplates, packageTemplatesController.list);
router.post("/",      ...auth, addPackageTemplate, validateCreatePackageTemplate, packageTemplatesController.create);
router.get("/:id",    ...auth, viewPackageTemplates, packageTemplatesController.getById);
router.patch("/:id",  ...auth, editPackageTemplate, validateUpdatePackageTemplate, packageTemplatesController.update);
router.delete("/:id", ...auth, deletePackageTemplate, packageTemplatesController.delete);

export default router;
