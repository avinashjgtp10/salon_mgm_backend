import { Router } from "express";
import { bookingsController } from "./bookings.controller";

const router = Router();

// Must precede /salon/:salon_id so "slug" isn't captured as a salon_id.
router.get("/salon/slug/:slug", bookingsController.getSalonBySlug);
router.get("/salon/:salon_id", bookingsController.getSalonDetails);
router.get("/salon/:salon_id/availability", bookingsController.getAvailability);
router.post("/", bookingsController.createBooking);

// Client self-service — authorized by a signed token, not a login session.
router.get("/manage/:appointmentId", bookingsController.getManagedBooking);
router.post("/manage/:appointmentId/cancel", bookingsController.cancelManagedBooking);
router.patch("/manage/:appointmentId/reschedule", bookingsController.rescheduleManagedBooking);

export default router;
