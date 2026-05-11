import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { membershipsController } from "./memberships.controller";
import {
  validateCreateMembership,
  validateUpdateMembership,
  validateMembershipsListQuery,
  validateExportQuery,
} from "./memberships.validator";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];

router.get("/",            ...guard, validateMembershipsListQuery, membershipsController.list);
router.get("/export/csv",   ...guard, validateExportQuery, membershipsController.exportCsv);
router.get("/export/excel", ...guard, validateExportQuery, membershipsController.exportExcel);
router.get("/export/pdf",   ...guard, validateExportQuery, membershipsController.exportPdf);
router.post("/",           ...guard, validateCreateMembership,     membershipsController.create);
router.get("/:id",         ...guard,                               membershipsController.getById);
router.patch("/:id",       ...guard, validateUpdateMembership,     membershipsController.update);
router.delete("/:id",      ...guard,                               membershipsController.delete);

export default router;