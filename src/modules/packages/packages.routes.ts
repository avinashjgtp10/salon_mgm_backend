import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSalon } from "../../middleware/salon.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { packagesController } from "./packages.controller";
import {
  validateCreatePackage,
  validateUpdatePackage,
  validatePackagesListQuery,
} from "./packages.validator";

const router = Router();
const auth      = [authMiddleware, requireSalon];
const ownerAdmin = roleMiddleware("salon_owner", "admin");

// Export routes MUST come before /:id to avoid param matching
router.get("/export/csv",   ...auth, packagesController.exportCsv);
router.get("/export/excel", ...auth, packagesController.exportExcel);
router.get("/export/pdf",   ...auth, packagesController.exportPdf);

// CRUD
router.get("/",      ...auth, validatePackagesListQuery, packagesController.list);
router.post("/",     ...auth, ownerAdmin, validateCreatePackage,  packagesController.create);
router.get("/:id",   ...auth, packagesController.getById);
router.patch("/:id", ...auth, ownerAdmin, validateUpdatePackage,  packagesController.update);
router.delete("/:id",...auth, ownerAdmin, packagesController.delete);

export default router;
