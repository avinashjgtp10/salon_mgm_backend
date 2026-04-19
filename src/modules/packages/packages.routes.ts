import { Router } from "express";
import { packagesController } from "./packages.controller";
import {
  validateCreatePackage,
  validateUpdatePackage,
  validatePackagesListQuery,
} from "./packages.validator";

const router = Router();

// Export routes MUST come before /:id to avoid param matching
router.get("/export/csv",   packagesController.exportCsv);
router.get("/export/excel", packagesController.exportExcel);
router.get("/export/pdf",   packagesController.exportPdf);

// CRUD
router.get("/",     validatePackagesListQuery, packagesController.list);
router.post("/",    validateCreatePackage,     packagesController.create);
router.get("/:id",                             packagesController.getById);
router.patch("/:id", validateUpdatePackage,    packagesController.update);
router.delete("/:id",                          packagesController.delete);

export default router;
