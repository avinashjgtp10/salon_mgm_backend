import { Router, type Request, type Response, type NextFunction } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission, requireExportFormatPermission } from "../../middleware/permission.middleware";
import { staffPermissionsController } from "../roles/roles.controller";
import { upload } from "./staff.upload";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import {
  staffController, staffInvitationController, staffAddressController,
  staffEmergencyContactController, staffWagesController, staffCommissionsController,
  staffTipsController,
  staffPayRunsController, staffSchedulesController, staffLeavesController,
} from "./staff.controller";
import {
  validateCreateStaff, validateUpdateStaff,
  validateCreateStaffAddress, validateUpdateStaffAddress,
  validateCreateEmergencyContact, validateUpdateEmergencyContact,
  validateUpdateWageSettings, validateUpdateCommission, validateUpdatePayRun,
  validateUpsertStaffSchedules, validateCreateStaffLeave, validateUpdateStaffLeave,
  validateAcceptInvitation,
} from "./staff.validator";
import { blockedTimesController } from "../blocked_times/blocked_times.controller";
import { validateCreateStaffBlockedTime, validateUpdateBlockedTime } from "../blocked_times/blocked_times.validator";

const router = Router();
const auth = authMiddleware;
const ownerAdmin = roleMiddleware("salon_owner", "admin");
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Wages/Commissions/Tips were previously owner/admin-only with no permission
// key at all (view_payroll being the sole exception — it existed but was
// dead for the same role-gate reason). All four opened to staff this phase.
const viewWages = requirePermission("view_wages");
const manageWages = requirePermission("manage_wages");
const viewCommissions = requirePermission("view_commissions");
const manageCommissions = requirePermission("manage_commissions");
const viewTips = requirePermission("view_tips");
const manageTips = requirePermission("manage_tips");
// Staff addresses/emergency contacts/schedules/leaves — role gate unchanged
// (owner/admin for writes, as before), just adding the permission check
// that was missing entirely.
const manageStaffPersonalData = requirePermission("manage_staff_personal_data");

// ─── Public (no auth) ─────────────────────────────────────────────────────────
router.get("/invite/:token/verify", staffInvitationController.verifyToken);
router.post("/invite/accept", validateAcceptInvitation, staffInvitationController.acceptInvitation);

// ─── Staff CRUD ───────────────────────────────────────────────────────────────
// Quick Sale and Calendar both need to list staff to assign one to an
// appointment/sale line item — and Calendar needs it just to VIEW the
// calendar at all, since it renders one column per staff member (view_calendar
// alone, not just manage_calendar, has to be enough — you don't need edit
// rights on the calendar to see who it's organized by).
const viewTeamOrBooking = requireAnyPermission(["view_team", "create_sales", "manage_calendar", "view_calendar"]);
router.get("/", auth, ownerAdminStaff, viewTeamOrBooking, staffController.list);
router.post("/", auth, ownerAdmin, requirePermission("add_team_member"), validateCreateStaff, staffController.create);

// ─── Avatar upload (stateless — must be BEFORE /:id) ─────────────────────────
router.post("/upload-avatar", auth, ownerAdmin, uploadMiddleware.single("avatar"), staffController.uploadAvatar);

// ─── Import / Export (must be BEFORE /:id) ───────────────────────────────────
router.post("/import",       auth, ownerAdmin, requirePermission("import_file"),   upload.single("file"), staffController.importStaff);
router.get("/export/excel",  auth, ownerAdmin, requirePermission("export_excel"),  staffController.exportExcel);
router.get("/export/csv",    auth, ownerAdmin, requirePermission("export_csv"),    staffController.exportCsv);

// ─── Commissions — salon-wide (must be BEFORE /:staffId routes) ──────────────
// Previously owner/admin-only with no permission key — opened to staff via
// view_commissions/manage_commissions per the same decision that opened
// Payroll/Wages/Tips/Marketing this phase.
router.get("/commissions/summary",              auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getCommissionSummary);
router.get("/commissions/earned",               auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getEarnedBySalon);
router.get("/commissions/export",               auth, ownerAdminStaff, viewCommissions, requireExportFormatPermission(["csv", "excel", "json"], "csv", { json: "pdf" }), staffCommissionsController.exportCommissions);
router.post("/commissions/:staffId/mark-paid",  auth, ownerAdminStaff, manageCommissions, staffCommissionsController.markStaffCommissionPaid);
router.get("/commissions/:staffId/settlements", auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getSettlementHistory);
router.get("/commissions/all",                  auth, ownerAdminStaff, viewCommissions, staffCommissionsController.listBySalon);
router.post("/commissions/bulk-configure",      auth, ownerAdminStaff, manageCommissions, staffCommissionsController.bulkConfigure);

// ─── Tips — salon-wide (must be BEFORE /:staffId routes, same reason as
// Commissions above — a literal segment like "tips" registered after a
// "/:staffId" route would otherwise be swallowed by it) ──────────────────────
router.get("/tips/summary",              auth, ownerAdminStaff, viewTips, staffTipsController.getTipSummary);
router.get("/tips/earned",               auth, ownerAdminStaff, viewTips, staffTipsController.getEarnedBySalon);
router.post("/tips/:staffId/settle",     auth, ownerAdminStaff, manageTips, staffTipsController.settleStaffTip);
router.get("/tips/:staffId/settlements", auth, ownerAdminStaff, viewTips, staffTipsController.getSettlementHistory);

// ─── Commission Slabs + History — per staff ──────────────────────────────────
router.get("/:staffId/commissions/slabs",   auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getSlabs);
router.put("/:staffId/commissions/slabs",   auth, ownerAdminStaff, manageCommissions, staffCommissionsController.upsertSlabs);
router.get("/:staffId/commissions/history", auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getStaffHistory);

// ─── Roles & Permissions — bulk (must be BEFORE /:id routes, same reason as
// Commissions/Tips above) ──────────────────────────────────────────────────
router.post("/bulk/role",             auth, ownerAdmin, requirePermission("manage_roles"), staffPermissionsController.bulkAssignRole);
router.post("/bulk/reset-overrides",  auth, ownerAdmin, requirePermission("manage_roles"), staffPermissionsController.bulkResetOverrides);

// ─── Staff by ID ──────────────────────────────────────────────────────────────
router.get("/:id",    auth, ownerAdminStaff, requirePermission("view_team"), staffController.getById);

// ─── Roles & Permissions — per staff ─────────────────────────────────────────
router.get("/:id/permissions",   auth, ownerAdminStaff, requirePermission("view_team"), requireAnyPermission(["view_roles", "manage_roles"]), staffPermissionsController.getEffective);
router.patch("/:id/permissions", auth, ownerAdmin, requirePermission("manage_roles"), staffPermissionsController.setOverrides);
router.patch("/:id/role",        auth, ownerAdmin, requirePermission("manage_roles"), staffPermissionsController.assignRole);
router.patch("/:id",  auth, ownerAdmin, requirePermission("edit_team_member"), validateUpdateStaff, staffController.update);
router.patch("/:id/activate",   auth, ownerAdmin, requirePermission("edit_team_member"), staffController.activate);
router.patch("/:id/deactivate", auth, ownerAdmin, requirePermission("edit_team_member"), staffController.deactivate);
router.delete("/:id", auth, ownerAdmin, requirePermission("edit_team_member"), staffController.delete);

// ─── Invitation management ────────────────────────────────────────────────────
router.get("/:id/invitation-status", auth, ownerAdmin, staffInvitationController.getInvitationStatus);
router.post("/:id/resend-invite",    auth, ownerAdmin, staffInvitationController.resendInvitation);
router.delete("/:id/cancel-invite",  auth, ownerAdmin, staffInvitationController.cancelInvitation);

// ─── Addresses ────────────────────────────────────────────────────────────────
// Role gate unchanged (still owner/admin for writes) — this ticket only
// closes the missing-permission-check gap, it doesn't change who's eligible.
router.get("/:staffId/addresses",         auth, ownerAdminStaff, manageStaffPersonalData, staffAddressController.list);
router.post("/:staffId/addresses",        auth, ownerAdmin, manageStaffPersonalData, validateCreateStaffAddress, staffAddressController.create);
router.patch("/:staffId/addresses/:id",   auth, ownerAdmin, manageStaffPersonalData, validateUpdateStaffAddress, staffAddressController.update);
router.delete("/:staffId/addresses/:id",  auth, ownerAdmin, manageStaffPersonalData, staffAddressController.delete);

// ─── Emergency Contacts ───────────────────────────────────────────────────────
router.get("/:staffId/emergency-contacts",        auth, ownerAdminStaff, manageStaffPersonalData, staffEmergencyContactController.list);
router.post("/:staffId/emergency-contacts",       auth, ownerAdmin, manageStaffPersonalData, validateCreateEmergencyContact, staffEmergencyContactController.create);
router.patch("/:staffId/emergency-contacts/:id",  auth, ownerAdmin, manageStaffPersonalData, validateUpdateEmergencyContact, staffEmergencyContactController.update);
router.delete("/:staffId/emergency-contacts/:id", auth, ownerAdmin, manageStaffPersonalData, staffEmergencyContactController.delete);

// ─── Wages ────────────────────────────────────────────────────────────────────
router.get("/:staffId/wages", auth, ownerAdminStaff, viewWages, staffWagesController.get);
router.put("/:staffId/wages", auth, ownerAdminStaff, manageWages, validateUpdateWageSettings, staffWagesController.upsert);

// ─── Commissions — per staff ──────────────────────────────────────────────────
router.get("/:staffId/commissions", auth, ownerAdminStaff, viewCommissions, staffCommissionsController.list);
router.put("/:staffId/commissions", auth, ownerAdminStaff, manageCommissions, validateUpdateCommission, staffCommissionsController.upsert);

// ─── Pay Runs ─────────────────────────────────────────────────────────────────
router.get("/:staffId/pay-runs", auth, ownerAdmin, staffPayRunsController.get);
router.put("/:staffId/pay-runs", auth, ownerAdmin, validateUpdatePayRun, staffPayRunsController.upsert);

// ─── Schedules ────────────────────────────────────────────────────────────────
router.get("/:staffId/scheduled",    auth, ownerAdminStaff, manageStaffPersonalData, staffSchedulesController.list);
router.put("/:staffId/scheduled",    auth, ownerAdmin, manageStaffPersonalData, validateUpsertStaffSchedules, staffSchedulesController.upsert);
router.delete("/:staffId/scheduled", auth, ownerAdmin, manageStaffPersonalData, staffSchedulesController.delete);

// ─── Leaves ───────────────────────────────────────────────────────────────────
router.get("/:staffId/leaves",        auth, ownerAdminStaff, manageStaffPersonalData, staffLeavesController.list);
router.post("/:staffId/leaves",       auth, ownerAdmin, manageStaffPersonalData, validateCreateStaffLeave, staffLeavesController.create);
router.patch("/:staffId/leaves/:id",  auth, ownerAdmin, manageStaffPersonalData, validateUpdateStaffLeave, staffLeavesController.update);
router.delete("/:staffId/leaves/:id", auth, ownerAdmin, manageStaffPersonalData, staffLeavesController.delete);

// ─── Blocked Times (staff-scoped) ────────────────────────────────────────────
router.post(
  "/:staffId/blocked-times",
  auth, ownerAdminStaff,
  (req: Request, _res: Response, next: NextFunction) => { req.body.staff_id = req.params.staffId; next(); },
  validateCreateStaffBlockedTime,
  blockedTimesController.create
);
router.get(
  "/:staffId/blocked-times",
  auth, ownerAdminStaff,
  (req: Request, _res: Response, next: NextFunction) => { req.query.staff_id = req.params.staffId; next(); },
  blockedTimesController.list
);
router.patch(
  "/:staffId/blocked-times/:id",
  auth, ownerAdminStaff,
  validateUpdateBlockedTime,
  blockedTimesController.update
);
router.delete(
  "/:staffId/blocked-times/:id",
  auth, ownerAdminStaff,
  blockedTimesController.delete
);

export default router;