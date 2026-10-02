import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission, requireAnyPermission, requireExportFormatPermission } from "../../middleware/permission.middleware";
import { appointmentsController } from "./appointments.controller";
import { requirePaidBillEditPermission } from "./appointments.guards";
import {
    validateCreateAppointment, validateUpdateAppointment, validateCheckoutAppointment,
} from "./appointments.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

// create_sales is OR'd in for the same reason as :id/checkout below — Quick
// Sale creates its walk-in appointment through this same route, so a staff
// member who can bill a Quick Sale but has no Calendar access must not get a
// "create_appointment" Permission Required popup on the very first save.
router.post("/", authMiddleware, ownerAdminStaff, requireAnyPermission(["create_appointment", "create_sales"]), validateCreateAppointment, appointmentsController.create);
// Also accepts view_dashboard_appointments — the Dashboard's "Today's
// Appointments" widget calls this same list endpoint for live data (see
// useTodayAppointments.ts) rather than the dashboard's own stale bundled
// snapshot, so a staff member with only the Dashboard-scoped permission can
// still see that preview without needing full Calendar module access.
router.get("/", authMiddleware, ownerAdminStaff, requireAnyPermission(["view_calendar", "view_dashboard_appointments"]), appointmentsController.list);
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_calendar"), requireExportFormatPermission(["csv", "excel"], "csv"), appointmentsController.exportAppointments);
router.post("/bulk-delete", authMiddleware, ownerAdminStaff, requirePermission("delete_appointment"), appointmentsController.bulkDelete);
router.get("/:id", authMiddleware, ownerAdminStaff, requirePermission("view_appointment"), appointmentsController.getById);
// create_sales is OR'd in for the same reason as :id/checkout below — editing
// an in-progress Quick Sale walk-in appointment (e.g. adding another item
// before checkout) goes through this same route.
// requirePaidBillEditPermission adds the separate edit_paid_bill check when the
// appointment is already paid (staff only) — see appointments.guards.ts.
router.patch("/:id", authMiddleware, ownerAdminStaff, requireAnyPermission(["edit_appointment", "create_sales"]), requirePaidBillEditPermission, validateUpdateAppointment, appointmentsController.update);
router.post("/:id/cancel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("cancel_appointment"), appointmentsController.cancel);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("delete_appointment"), appointmentsController.delete);
// Gated by edit_appointment ("Edit & Payment Appointment"), not
// create_appointment ("Create Booking Appointment") — the Calendar
// permissions rename ticket split the two apart so booking a brand-new
// appointment never implies the ability to record a payment on one.
//
// create_sales is OR'd in because Quick Sale is a walk-in appointment under
// the hood: after a Quick Sale payment settles, usePayment.ts fires this
// endpoint so commission calculation runs and the appointment is marked
// completed (payments.service.ts creates the sales row but deliberately
// stops short of both). Without it, a staff member who can bill a Quick
// Sale but has no Calendar access got a spurious "edit_appointment"
// Permission Required popup on every completed sale — the payment itself
// had already succeeded — and commission silently never fired for them.
// Consistent with create_sales' own catalog description, "Create, edit and
// checkout sales".
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requireAnyPermission(["edit_appointment", "create_sales"]), validateCheckoutAppointment, appointmentsController.checkout);
router.get("/:id/receipt-pdf", authMiddleware, ownerAdminStaff, requirePermission("view_payment_details"), appointmentsController.getReceiptPdf);

export default router;
