import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requireMobileStaff } from "./mobileStaff.middleware";
import { mobileStaffController } from "./mobileStaff.controller";

// Dedicated API for staff using the SalonOX mobile app, mounted at
// /api/v1/mobile/staff. Access: valid JWT → staff role → the caller's own
// active staff record (requireMobileStaff). Role permissions are not consulted
// because every route is scoped to the caller's own data. Client headers such
// as X-Salonox-Client play no part in authorization here.
const router = Router();

router.use(authMiddleware, roleMiddleware("staff"), requireMobileStaff);

router.get("/me", mobileStaffController.me);
router.get("/me/calendar-access", mobileStaffController.calendarAccess);
router.get("/me/addresses", mobileStaffController.addresses);
router.get("/me/emergency-contacts", mobileStaffController.emergencyContacts);

router.get("/appointments", mobileStaffController.appointments);
router.get("/appointments/:id", mobileStaffController.appointmentById);

router.get("/schedule", mobileStaffController.schedule);

router.get("/attendance", mobileStaffController.attendance);
router.post("/attendance/check-in", mobileStaffController.checkIn);
router.post("/attendance/check-out", mobileStaffController.checkOut);

router.get("/notifications", mobileStaffController.notifications);
router.get("/notifications/unread-count", mobileStaffController.unreadNotificationCount);
router.patch("/notifications/read-all", mobileStaffController.markAllNotificationsRead);
router.patch("/notifications/:id/read", mobileStaffController.markNotificationRead);

export default router;
