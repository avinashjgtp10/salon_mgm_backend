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

router.post("/", authMiddleware, ownerAdminStaff, requirePermission("create_appointments"), validateCreateAppointment, appointmentsController.create);
router.get("/", authMiddleware, ownerAdminStaff, requirePermission("view_appointments"), appointmentsController.list);
router.get("/export", authMiddleware, ownerAdminStaff, requirePermission("view_appointments"), appointmentsController.exportAppointments);
router.get("/:id", authMiddleware, ownerAdminStaff, requirePermission("view_appointments"), appointmentsController.getById);
router.patch("/:id", authMiddleware, ownerAdminStaff, requirePermission("edit_appointments"), validateUpdateAppointment, appointmentsController.update);
router.post("/:id/confirm", authMiddleware, ownerAdminStaff, requirePermission("edit_appointments"), appointmentsController.confirm);
router.post("/:id/start", authMiddleware, ownerAdminStaff, requirePermission("edit_appointments"), appointmentsController.start);
router.post("/:id/cancel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), requirePermission("cancel_appointments"), appointmentsController.cancel);
router.delete("/:id", authMiddleware, ownerAdminStaff, requirePermission("cancel_appointments"), appointmentsController.delete);
router.post("/:id/no-show", authMiddleware, ownerAdminStaff, requirePermission("cancel_appointments"), appointmentsController.noShow);
router.post("/:id/checkout", authMiddleware, ownerAdminStaff, requirePermission("create_sales"), validateCheckoutAppointment, appointmentsController.checkout);

export default router;
