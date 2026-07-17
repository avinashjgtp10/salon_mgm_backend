import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireAnyPermission } from "../../middleware/permission.middleware";
import { packagesController } from "./packages.controller";
import {
  validateCreatePackage,
  validateUpdatePackage,
  validatePackagesListQuery,
} from "./packages.validator";

const router = Router();
const auth      = [authMiddleware, requireSalon];
const ownerAdmin = roleMiddleware("salon_owner", "admin");
// Quick Sale and Calendar both need to read packages to build a sale/
// appointment, even for staff who weren't separately granted Catalog view.
const viewPackages = requireAnyPermission(["view_packages", "create_sales", "manage_calendar"]);

// Export routes MUST come before /:id to avoid param matching
router.get("/export/csv",   ...auth, viewPackages, packagesController.exportCsv);
router.get("/export/excel", ...auth, viewPackages, packagesController.exportExcel);
router.get("/export/pdf",   ...auth, viewPackages, packagesController.exportPdf);

// CRUD
router.get("/",      ...auth, viewPackages, validatePackagesListQuery, packagesController.list);
router.post("/",     ...auth, ownerAdmin, validateCreatePackage,  packagesController.create);
router.get("/:id",   ...auth, viewPackages, packagesController.getById);
router.patch("/:id", ...auth, ownerAdmin, validateUpdatePackage,  packagesController.update);
router.delete("/:id",...auth, ownerAdmin, packagesController.delete);

export default router;
