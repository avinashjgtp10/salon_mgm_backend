import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { membershipsController } from "./memberships.controller";
import {
  validateCreateMembership,
  validateExportQuery,
  validateMembershipsListQuery,
  validateUpdateMembership,
} from "./memberships.validator";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];
const ownerAdmin = [authMiddleware, roleMiddleware("salon_owner", "admin")];

router.get("/", ...guard, validateMembershipsListQuery, membershipsController.list);
router.get("/filter", ...ownerAdmin, validateMembershipsListQuery, membershipsController.filter);
router.get("/export/csv", ...guard, validateMembershipsListQuery, validateExportQuery, membershipsController.exportCsv);
router.get("/export/excel", ...guard, validateMembershipsListQuery, validateExportQuery, membershipsController.exportExcel);
router.get("/export/pdf", ...guard, validateMembershipsListQuery, validateExportQuery, membershipsController.exportPdf);
router.post("/", ...guard, validateCreateMembership, membershipsController.create);
router.get("/:id", ...guard, membershipsController.getById);
router.patch("/:id", ...guard, validateUpdateMembership, membershipsController.update);
router.delete("/:id", ...guard, membershipsController.delete);

export default router;
