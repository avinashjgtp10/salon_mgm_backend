import { Router } from "express";
import { membershipsController } from "./memberships.controller";
import {
  validateCreateMembership,
  validateUpdateMembership,
  validateMembershipsListQuery,
  validateExportQuery,
} from "./memberships.validator";

const router = Router();

router.get("/",            validateMembershipsListQuery, membershipsController.list);
router.get("/export/csv",   validateExportQuery, membershipsController.exportCsv);
router.get("/export/excel", validateExportQuery, membershipsController.exportExcel);
router.get("/export/pdf",   validateExportQuery, membershipsController.exportPdf);
router.post("/",           validateCreateMembership,     membershipsController.create);
router.get("/:id",                                       membershipsController.getById);
router.patch("/:id",       validateUpdateMembership,     membershipsController.update);
router.delete("/:id",                                    membershipsController.delete);

export default router;