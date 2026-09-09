import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { packagesController } from "./packages.controller";
import {
  validateCreatePackage,
  validateUpdatePackage,
  validatePackagesListQuery,
} from "./packages.validator";

const router = Router();
const auth      = [authMiddleware, requireSalon, roleMiddleware("salon_owner", "admin", "staff")];
// Quick Sale and Calendar both need to read packages to build a sale/
// appointment, even for staff who weren't separately granted Catalog view.
const viewPackages = requireAnyPermission(["view_packages", "create_sales", "manage_calendar"]);
// featureKey "packages" (Advance tier and up) gates creating/editing and the
// plain listing page — NOT /:id, which Quick Sale/Calendar depend on to read
// an existing package when building a sale/appointment.
const requirePackagesFeature = requirePlanFeature("packages");
// Previously create/edit/delete were role-only (owner/admin) with no
// permission check at all — create_packages existed in the catalog but was
// never wired to anything. Now real, and staff-reachable via these keys.
const createPackages = requirePermission("create_packages");
const editPackages = requirePermission("edit_packages");
const deletePackages = requirePermission("delete_packages");

// Export routes MUST come before /:id to avoid param matching
router.get("/export/csv",   ...auth, viewPackages, requirePackagesFeature, packagesController.exportCsv);
router.get("/export/excel", ...auth, viewPackages, requirePackagesFeature, packagesController.exportExcel);
router.get("/export/pdf",   ...auth, viewPackages, requirePackagesFeature, packagesController.exportPdf);

// CRUD
router.get("/",      ...auth, viewPackages, requirePackagesFeature, validatePackagesListQuery, packagesController.list);
router.post("/",     ...auth, createPackages, requirePackagesFeature, validateCreatePackage,  packagesController.create);
router.get("/:id",   ...auth, viewPackages, packagesController.getById);
router.patch("/:id", ...auth, editPackages, requirePackagesFeature, validateUpdatePackage,  packagesController.update);
router.delete("/:id",...auth, deletePackages, requirePackagesFeature, packagesController.delete);

export default router;
