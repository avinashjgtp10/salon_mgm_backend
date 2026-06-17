import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { attendanceController } from "./attendance.controller";

const router = Router();
const ownerAdmin = roleMiddleware("salon_owner", "admin");
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

// Settings
router.get("/settings",    authMiddleware, ownerAdmin,      attendanceController.getSettings);
router.put("/settings",    authMiddleware, ownerAdmin,      attendanceController.updateSettings);

// Dashboard + grid
router.get("/today",       authMiddleware, ownerAdminStaff, attendanceController.getToday);
router.get("/monthly",     authMiddleware, ownerAdminStaff, attendanceController.getMonthly);
router.get("/summary",     authMiddleware, ownerAdminStaff, attendanceController.getDailySummary);
router.get("/export",      authMiddleware, ownerAdmin,      attendanceController.exportCSV);

// Check in/out
router.post("/check-in",   authMiddleware, ownerAdminStaff, attendanceController.checkIn);
router.post("/check-out",  authMiddleware, ownerAdminStaff, attendanceController.checkOut);

// Biometric/QR/GPS device push (device must be configured with an auth token)
router.post("/push",       authMiddleware, ownerAdminStaff, attendanceController.push);

// Manual mark / edit
router.post("/mark",       authMiddleware, ownerAdmin,      attendanceController.manualMark);
router.patch("/:id",       authMiddleware, ownerAdmin,      attendanceController.updateRecord);

export default router;
