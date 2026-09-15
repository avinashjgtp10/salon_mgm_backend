import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
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
// featureKey "memberships" (Advance tier and up) gates creating/editing
// memberships and the plain listing page — NOT the GET routes Quick
// Sale/Calendar depend on to read existing memberships when building a
// sale/appointment, which stay available to every tier. See
// Migration/add_feature_key_to_salon_plans.sql.
const requireMembershipsFeature = requirePlanFeature("memberships");
const editMemberships = requirePermission("edit_memberships");
const deleteMemberships = requirePermission("delete_memberships");
// Download CSV/Excel/PDF are their own dedicated permissions (Membership
// permissions ticket). export_csv/excel/pdf (System) are now global master
// gates, not OR'd fallbacks — BOTH the specific and the global key are
// required (Global Download Switches ticket).
const exportMembershipsCsv = [requirePermission("download_membership_csv"), requirePermission("export_csv")];
const exportMembershipsExcel = [requirePermission("download_membership_excel"), requirePermission("export_excel")];
const exportMembershipsPdf = [requirePermission("download_membership_pdf"), requirePermission("export_pdf")];

router.get("/",            ...guard, viewMemberships, requireMembershipsFeature, validateMembershipsListQuery, membershipsController.list);
// Must precede "/:id" — otherwise these are swallowed as an id.
router.get("/loyalty-eligibility", ...guard, viewMemberships, membershipsController.loyaltyEligibility);
router.get("/filter-options",      ...guard, viewMemberships, requireMembershipsFeature, membershipsController.filterOptions);
router.get("/export/csv",   ...guard, viewMemberships, requireMembershipsFeature, ...exportMembershipsCsv,   validateExportQuery, membershipsController.exportCsv);
router.get("/export/excel", ...guard, viewMemberships, requireMembershipsFeature, ...exportMembershipsExcel, validateExportQuery, membershipsController.exportExcel);
router.get("/export/pdf",   ...guard, viewMemberships, requireMembershipsFeature, ...exportMembershipsPdf,   validateExportQuery, membershipsController.exportPdf);
router.post("/",           ...guard, createMemberships, requireMembershipsFeature, validateCreateMembership,     membershipsController.create);
router.get("/:id",         ...guard, viewMemberships,                                 membershipsController.getById);
router.patch("/:id",       ...guard, editMemberships, requireMembershipsFeature, validateUpdateMembership,       membershipsController.update);
router.delete("/:id",      ...guard, deleteMemberships, requireMembershipsFeature,                               membershipsController.delete);

export default router;