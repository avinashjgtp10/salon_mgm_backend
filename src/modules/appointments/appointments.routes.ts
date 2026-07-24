import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { appointmentsController } from "./appointments.controller";
import {
    validateCreateAppointment, validateUpdateAppointment, validateCheckoutAppointment,
} from "./appointments.validator";

const router = Router();
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");

router.post("/", authMiddleware, ownerAdminStaff, requirePermission("manage_calendar"), validateCreateAppointment, appointmentsController.create);
router.get("/", authMiddleware, ownerAdminStaff, requirePermission("view_calendar"), appointmentsController.list);
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_calendar"), appointmentsController.exportAppointments);
router.post("/bulk-delete", authMiddleware, ownerAdminStaff, requirePermission("manage_calendar"), appointmentsController.bulkDelete);
router.get("/:id", authMiddleware, ownerAdminStaff, requirePermission("view_calendar"), appointmentsController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, requirePermission("manage_calendar"), validateUpdateAppointment, appointmentsController.update);
router.post("/:id/cancel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("manage_calendar"), appointmentsController.cancel);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("manage_calendar"), appointmentsController.delete);
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCheckoutAppointment, appointmentsController.checkout);

export default router;
