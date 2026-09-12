import { Router, type Request, type Response, type NextFunction } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
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
const manageWages = requirePermission("manage_wages");
// The Payroll Dashboard's Base Salary column reads each staff member's wage
// settings for display — same cross-module read dependency as the
// commissions/tips OR-fallbacks below. view_wages itself has no catalog row
// (removed per feedback_no_proactive_permission_backfill) and so can never
// be granted through any UI, which made this route permanently unreachable
// for staff and broke Payroll's own ticketed Base Salary column.
const viewWagesOrPayroll = requireAnyPermission(["view_wages", "view_payroll"]);
const viewCommissions = requirePermission("view_commissions");
const manageCommissions = requirePermission("manage_commissions");
const viewTips = requirePermission("view_tips");
// The Payroll Dashboard (view_payroll) reads commission totals/history as
// display-only enrichment for its Commission Paid/Pending columns — without
// this OR, a staff member granted only the Payroll ticket's keys (not Tip &
// Commission's) gets a hard 403 on page load just from this background
// fetch. Scoped to only the two read routes Payroll actually calls; every
// other commissions route (including the write ones) still requires
// view_commissions/manage_commissions on its own, unrelated to Payroll.
const viewCommissionsOrPayroll = requireAnyPermission(["view_commissions", "view_payroll"]);
// Reports ticket: Commission Report has no dedicated backend endpoint — it
// reuses these two commissions routes. New report-specific key OR'd
// alongside the existing feature permissions, same treatment as the other
// no-route reports (see inventory.routes.ts/attendance.routes.ts).
const viewCommissionsOrReport = requireAnyPermission(["view_commissions", "view_report_commission_report"]);
const viewCommissionsOrPayrollOrReport = requireAnyPermission(["view_commissions", "view_payroll", "view_report_commission_report"]);
const viewTipsOrPayroll = requireAnyPermission(["view_tips", "view_payroll"]);
// Staff addresses/emergency contacts/schedules/leaves — role gate unchanged
// (owner/admin for writes, as before), just adding the permission check
// that was missing entirely.
const manageStaffPersonalData = requirePermission("manage_staff_personal_data");

// Staff List now has its own independent Delete/Deactivate/Import/Export
// permissions too (see the Staff permissions ticket). Several of these
// routes were also previously owner/admin-ONLY at the role layer (staff
// excluded regardless of any permission) — widened to ownerAdminStaff below
// so granting a staff member one of these new keys is actually meaningful.
const createStaff = requirePermission("add_team_member");
const editStaff = requirePermission("edit_team_member");
const deactivateStaff = requireAnyPermission(["deactivate_staff", "edit_team_member"]);
const deleteStaffPerm = requireAnyPermission(["delete_staff", "edit_team_member"]);
// import_file/export_csv/excel (System) are now global master gates, not
// OR'd fallbacks — BOTH the specific permission AND the matching global
// switch are required (Global Download Switches ticket).
const importStaff = [requirePermission("import_staff"), requirePermission("import_file")];
const exportStaffExcel = [requirePermission("export_staff_excel"), requirePermission("export_excel")];
const exportStaffCsv = [requirePermission("export_staff_csv"), requirePermission("export_csv")];

// Scheduled Shifts now has its own independent View/Add Working Hours/Edit
// Working Hours/Add Time Off/Manage Day Off/Manage Blocked Day/Copy
// Schedule permissions too (see the Scheduled Shifts ticket). The upsert
// endpoints below are shared by several of these distinct UI actions (one
// PUT /:staffId/scheduled backs Working Hours, Day Off, Blocked Day, and
// Copy Schedule all alike) — OR'd together here as the backend boundary,
// while the frontend gates each button with its own specific key for the
// real "each works independently" UX. Role gate widened from owner/admin to
// ownerAdminStaff on the writes so these are actually staff-delegable. Gated
// solely by this ticket's own dedicated keys — no fallback to the older
// manage_staff_personal_data (kept only on addresses/emergency-contacts
// below, which predate this ticket and are out of its scope).
const viewScheduledShifts = requirePermission("view_scheduled_shifts");
const upsertSchedule = requireAnyPermission([
  "add_working_hours", "edit_working_hours", "manage_day_off", "manage_blocked_day", "copy_schedule",
]);
const manageTimeOff = requirePermission("add_time_off");
const manageBlockedDay = requirePermission("manage_blocked_day");

// Tip & Commission ticket adds dedicated download_commission_tip_csv/excel/
// pdf keys — same format-resolution logic as requireExportFormatPermission.
// export_csv/excel/pdf (System) are now global master gates: BOTH the
// dedicated key AND the matching global switch are required (Global
// Download Switches ticket), chained as two separate checks so both must
// pass.
const exportCommissionsFormat = (req: Request, res: Response, next: NextFunction) => {
  const raw = String(req.query.format || "").toLowerCase();
  const format = ["csv", "excel", "json"].includes(raw) ? raw : "csv";
  const resolved = format === "json" ? "pdf" : (format as "csv" | "excel");
  const dedicatedKey = resolved === "pdf" ? "download_commission_tip_pdf" : resolved === "excel" ? "download_commission_tip_excel" : "download_commission_tip_csv";
  const genericKey = resolved === "pdf" ? "export_pdf" : resolved === "excel" ? "export_excel" : "export_csv";
  return requirePermission(dedicatedKey)(req, res, (err?: unknown) => {
    if (err) return next(err);
    return requirePermission(genericKey)(req, res, next);
  });
};

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
router.post("/", auth, ownerAdminStaff, createStaff, validateCreateStaff, staffController.create);

// ─── Avatar upload (stateless — must be BEFORE /:id) ─────────────────────────
router.post("/upload-avatar", auth, ownerAdmin, uploadMiddleware.single("avatar"), staffController.uploadAvatar);

// ─── Import / Export (must be BEFORE /:id) ───────────────────────────────────
router.post("/import",       auth, ownerAdminStaff, ...importStaff,      upload.single("file"), staffController.importStaff);
router.get("/export/excel",  auth, ownerAdminStaff, ...exportStaffExcel, staffController.exportExcel);
router.get("/export/csv",    auth, ownerAdminStaff, ...exportStaffCsv,   staffController.exportCsv);

// ─── Commissions — salon-wide (must be BEFORE /:staffId routes) ──────────────
// Previously owner/admin-only with no permission key — opened to staff via
// view_commissions/manage_commissions per the same decision that opened
// Payroll/Wages/Tips/Marketing this phase.
router.get("/commissions/summary",              auth, ownerAdminStaff, viewCommissionsOrReport, staffCommissionsController.getCommissionSummary);
router.get("/commissions/earned",               auth, ownerAdminStaff, viewCommissionsOrPayrollOrReport, staffCommissionsController.getEarnedBySalon);
router.get("/commissions/export",               auth, ownerAdminStaff, viewCommissions, exportCommissionsFormat, staffCommissionsController.exportCommissions);
router.post("/commissions/:staffId/mark-paid",  auth, ownerAdminStaff, manageCommissions, staffCommissionsController.markStaffCommissionPaid);
router.get("/commissions/:staffId/settlements", auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getSettlementHistory);
router.get("/commissions/all",                  auth, ownerAdminStaff, viewCommissions, staffCommissionsController.listBySalon);
router.post("/commissions/bulk-configure",      auth, ownerAdminStaff, manageCommissions, staffCommissionsController.bulkConfigure);

// ─── Tips — salon-wide (must be BEFORE /:staffId routes, same reason as
// Commissions above — a literal segment like "tips" registered after a
// "/:staffId" route would otherwise be swallowed by it) ──────────────────────
router.get("/tips/summary",              auth, ownerAdminStaff, viewTips, staffTipsController.getTipSummary);
router.get("/tips/earned",               auth, ownerAdminStaff, viewTipsOrPayroll, staffTipsController.getEarnedBySalon);
// Settle Tip is gated by the new dedicated edit_tip (Tip & Commission
// ticket) OR the existing manageTips — no distinct add_tip/delete_tip
// backend action exists (tips are auto-earned at checkout, never manually
// created or deleted), so those two keys are defined in the catalog for
// completeness but have no route to wire to.
router.post("/tips/:staffId/settle",     auth, ownerAdminStaff, requireAnyPermission(["edit_tip", "manage_tips"]), staffTipsController.settleStaffTip);
router.get("/tips/:staffId/settlements", auth, ownerAdminStaff, viewTips, staffTipsController.getSettlementHistory);

// ─── Commission Slabs + History — per staff ──────────────────────────────────
router.get("/:staffId/commissions/slabs",   auth, ownerAdminStaff, viewCommissions, staffCommissionsController.getSlabs);
router.put("/:staffId/commissions/slabs",   auth, ownerAdminStaff, manageCommissions, staffCommissionsController.upsertSlabs);
router.get("/:staffId/commissions/history", auth, ownerAdminStaff, viewCommissionsOrPayroll, staffCommissionsController.getStaffHistory);

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
router.patch("/:id",  auth, ownerAdminStaff, editStaff, validateUpdateStaff, staffController.update);
router.patch("/:id/activate",   auth, ownerAdminStaff, deactivateStaff, staffController.activate);
router.patch("/:id/deactivate", auth, ownerAdminStaff, deactivateStaff, staffController.deactivate);
router.delete("/:id", auth, ownerAdminStaff, deleteStaffPerm, staffController.delete);

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
router.get("/:staffId/wages", auth, ownerAdminStaff, viewWagesOrPayroll, staffWagesController.get);
router.put("/:staffId/wages", auth, ownerAdminStaff, manageWages, validateUpdateWageSettings, staffWagesController.upsert);

// ─── Commissions — per staff ──────────────────────────────────────────────────
router.get("/:staffId/commissions", auth, ownerAdminStaff, viewCommissions, staffCommissionsController.list);
router.put("/:staffId/commissions", auth, ownerAdminStaff, manageCommissions, validateUpdateCommission, staffCommissionsController.upsert);

// ─── Pay Runs ─────────────────────────────────────────────────────────────────
router.get("/:staffId/pay-runs", auth, ownerAdmin, staffPayRunsController.get);
router.put("/:staffId/pay-runs", auth, ownerAdmin, validateUpdatePayRun, staffPayRunsController.upsert);

// ─── Schedules ────────────────────────────────────────────────────────────────
router.get("/:staffId/scheduled",    auth, ownerAdminStaff, viewScheduledShifts, staffSchedulesController.list);
router.put("/:staffId/scheduled",    auth, ownerAdminStaff, upsertSchedule, validateUpsertStaffSchedules, staffSchedulesController.upsert);
router.delete("/:staffId/scheduled", auth, ownerAdminStaff, upsertSchedule, staffSchedulesController.delete);

// ─── Leaves (Time Off) ────────────────────────────────────────────────────────
router.get("/:staffId/leaves",        auth, ownerAdminStaff, viewScheduledShifts, staffLeavesController.list);
router.post("/:staffId/leaves",       auth, ownerAdminStaff, manageTimeOff, validateCreateStaffLeave, staffLeavesController.create);
router.patch("/:staffId/leaves/:id",  auth, ownerAdminStaff, manageTimeOff, validateUpdateStaffLeave, staffLeavesController.update);
router.delete("/:staffId/leaves/:id", auth, ownerAdminStaff, manageTimeOff, staffLeavesController.delete);

// ─── Blocked Times (staff-scoped) — previously role-gate only, no
// permission check at all. Now gated by Manage Blocked Day (Scheduled
// Shifts ticket). ─────────────────────────────────────────────────────────
router.post(
  "/:staffId/blocked-times",
  auth, ownerAdminStaff, manageBlockedDay,
  (req: Request, _res: Response, next: NextFunction) => { req.body.staff_id = req.params.staffId; next(); },
  validateCreateStaffBlockedTime,
  blockedTimesController.create
);
router.get(
  "/:staffId/blocked-times",
  auth, ownerAdminStaff, viewScheduledShifts,
  (req: Request, _res: Response, next: NextFunction) => { req.query.staff_id = req.params.staffId; next(); },
  blockedTimesController.list
);
router.patch(
  "/:staffId/blocked-times/:id",
  auth, ownerAdminStaff, manageBlockedDay,
  validateUpdateBlockedTime,
  blockedTimesController.update
);
router.delete(
  "/:staffId/blocked-times/:id",
  auth, ownerAdminStaff, manageBlockedDay,
  blockedTimesController.delete
);

export default router;