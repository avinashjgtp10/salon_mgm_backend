import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { calendarController } from "./calendar.controller";
import {
    validateCreateAppointment,
    validateUpdateAppointment,
    validateCheckoutAppointment,
} from "./calendar.validator";

const router = Router();

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.post(
    "/",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    validateCreateAppointment,
    calendarController.create
);

router.get(
    "/",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    calendarController.list
);

router.get(
    "/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    calendarController.getById
);

router.patch(
    "/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    validateUpdateAppointment,
    calendarController.update
);

// ─── Status Transitions (POST — matching your Postman) ────────────────────────

router.post("/:id/confirm", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), calendarController.confirm);
router.post("/:id/start", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), calendarController.start);
router.post("/:id/cancel", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), calendarController.cancel);
router.post("/:id/no-show", authMiddleware, roleMiddleware("salon_owner", "admin", "staff"), calendarController.noShow);

// ─── Checkout ─────────────────────────────────────────────────────────────────

router.post(
    "/:id/checkout",
    authMiddleware,
    roleMiddleware("salon_owner", "admin", "staff"),
    validateCheckoutAppointment,
    calendarController.checkout
);

export default router;
