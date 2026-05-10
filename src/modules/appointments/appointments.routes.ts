import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { appointmentsController } from "./appointments.controller";
import {
    validateCreateAppointment, validateUpdateAppointment, validateCheckoutAppointment,
} from "./appointments.validator";

const router = Router();

router.post("/", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateCreateAppointment, appointmentsController.create);
router.get("/", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.list);
router.get("/export", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.exportAppointments);
router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.getById);
router.patch("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateUpdateAppointment, appointmentsController.update);
router.post("/:id/confirm", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.confirm);
router.post("/:id/start", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.start);
router.post("/:id/cancel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff", "client"), appointmentsController.cancel);
router.delete("/:id", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.delete);
router.post("/:id/no-show", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), appointmentsController.noShow);
router.post("/:id/checkout", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), validateCheckoutAppointment, appointmentsController.checkout);

export default router;
