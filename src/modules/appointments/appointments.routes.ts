import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission, requireExportFormatPermission } from "../../middleware/permission.middleware";
import { appointmentsController } from "./appointments.controller";
import {
    validateCreateAppointment, validateUpdateAppointment, validateCheckoutAppointment,
} from "./appointments.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

router.post("/", authMiddleware, ownerAdminStaff, requirePermission("create_appointment"), validateCreateAppointment, appointmentsController.create);
// Also accepts view_dashboard_appointments — the Dashboard's "Today's
// Appointments" widget calls this same list endpoint for live data (see
// useTodayAppointments.ts) rather than the dashboard's own stale bundled
// snapshot, so a staff member with only the Dashboard-scoped permission can
// still see that preview without needing full Calendar module access.
router.get("/", authMiddleware, ownerAdminStaff, requireAnyPermission(["view_calendar", "view_dashboard_appointments"]), appointmentsController.list);
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_calendar"), requireExportFormatPermission(["csv", "excel"], "csv"), appointmentsController.exportAppointments);
router.post("/bulk-delete", authMiddleware, ownerAdminStaff, requirePermission("delete_appointment"), appointmentsController.bulkDelete);
router.get("/:id", authMiddleware, ownerAdminStaff, requirePermission("view_appointment"), appointmentsController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, requirePermission("edit_appointment"), validateUpdateAppointment, appointmentsController.update);
router.post("/:id/cancel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("cancel_appointment"), appointmentsController.cancel);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("delete_appointment"), appointmentsController.delete);
// Independent from Quick Sale's create_sales — a staff member can be able
// to record payment on a Calendar appointment without having Quick Sale
// access, and vice versa (see the Calendar permissions ticket).
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requirePermission("create_appointment"), validateCheckoutAppointment, appointmentsController.checkout);
router.get("/:id/receipt-pdf", authMiddleware, ownerAdminStaff, requirePermission("view_payment_details"), appointmentsController.getReceiptPdf);

export default router;
