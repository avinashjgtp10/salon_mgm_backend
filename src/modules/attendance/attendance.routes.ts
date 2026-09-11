import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission } from "../../middleware/permission.middleware";
import { attendanceController } from "./attendance.controller";

const router = Router();
const ownerAdmin = roleMiddleware("salon_owner", "admin");
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
// Attendance previously had NO permission check at all (role-only). Now
// gated by the Attendance ticket's dedicated View Attendance List/View
// Attendance Rules keys — Rules (settings) covers both read and write since
// the ticket only asks for one combined permission ("can access and manage
// Attendance Rules"), not separate view/edit ones.
const viewAttendanceList = requirePermission("view_attendance_list");
const viewAttendanceRules = requirePermission("view_attendance_rules");
// Reports ticket: Attendance Report has no dedicated backend endpoint — it
// reuses this range endpoint. New report-specific key OR'd alongside the
// existing feature permission, same treatment as the other 4 no-route
// reports (see inventory.routes.ts).
const viewAttendanceListOrReport = requireAnyPermission(["view_attendance_list", "view_report_attendance_report"]);

// Settings (Attendance Rules)
router.get("/settings",    authMiddleware, ownerAdminStaff, viewAttendanceRules, attendanceController.getSettings);
router.put("/settings",    authMiddleware, ownerAdminStaff, viewAttendanceRules, attendanceController.updateSettings);

// Dashboard + grid
router.get("/today",       authMiddleware, ownerAdminStaff, viewAttendanceList, attendanceController.getToday);
router.get("/monthly",     authMiddleware, ownerAdminStaff, viewAttendanceList, attendanceController.getMonthly);
router.get("/range",       authMiddleware, ownerAdminStaff, viewAttendanceListOrReport, attendanceController.getRange);
router.get("/summary",     authMiddleware, ownerAdminStaff, viewAttendanceList, attendanceController.getDailySummary);
router.get("/export",      authMiddleware, ownerAdminStaff, requireAnyPermission(["view_attendance_list", "export_csv"]), attendanceController.exportCSV);
router.get("/staff/:staffId", authMiddleware, ownerAdminStaff, viewAttendanceList, attendanceController.getForStaff);

// Check in/out — self-service, not part of this ticket's permission list;
// left role-gated only, unchanged.
router.post("/check-in",   authMiddleware, ownerAdminStaff, attendanceController.checkIn);
router.post("/check-out",  authMiddleware, ownerAdminStaff, attendanceController.checkOut);

// Biometric/QR/GPS device push (device must be configured with an auth token)
router.post("/push",       authMiddleware, ownerAdminStaff, attendanceController.push);

// Manual mark / edit — not named in this ticket's permission list either;
// left owner/admin role-gated only, unchanged.
router.post("/mark",       authMiddleware, ownerAdmin,      attendanceController.manualMark);
router.patch("/:id",       authMiddleware, ownerAdmin,      attendanceController.updateRecord);

export default router;
