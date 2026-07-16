import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { membershipsController } from "./memberships.controller";
import {
  validateCreateMembership,
  validateUpdateMembership,
  validateMembershipsListQuery,
  validateExportQuery,
} from "./memberships.validator";

const router = Router();

const guard = [authMiddleware, roleMiddleware("salon_owner", "admin", "staff")];
// Quick Sale and Calendar both need to read memberships to build a sale/
// appointment, even for staff who weren't separately granted Catalog view.
const viewMemberships = requireAnyPermission(["view_memberships", "create_sales", "manage_calendar"]);
const createMemberships = requirePermission("create_memberships");

router.get("/",            ...guard, viewMemberships, validateMembershipsListQuery, membershipsController.list);
router.get("/export/csv",   ...guard, viewMemberships, validateExportQuery, membershipsController.exportCsv);
router.get("/export/excel", ...guard, viewMemberships, validateExportQuery, membershipsController.exportExcel);
router.get("/export/pdf",   ...guard, viewMemberships, validateExportQuery, membershipsController.exportPdf);
router.post("/",           ...guard, createMemberships, validateCreateMembership,     membershipsController.create);
router.get("/:id",         ...guard, viewMemberships,                                 membershipsController.getById);
router.patch("/:id",       ...guard, createMemberships, validateUpdateMembership,     membershipsController.update);
router.delete("/:id",      ...guard, createMemberships,                               membershipsController.delete);

export default router;