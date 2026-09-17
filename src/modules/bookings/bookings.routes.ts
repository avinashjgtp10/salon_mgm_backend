import { Router } from "express";
import { bookingsController } from "./bookings.controller";
import {
  validateCreateBooking,
  validateAvailabilityQuery,
  validateManageToken,
  validateReschedule,
  validateCancel,
} from "./bookings.validator";
import { bookingWriteRateLimit, bookingReadRateLimit } from "./bookings.rate-limit";

const router = Router();

// Every route here is UNAUTHENTICATED — reachable by anyone holding a salon's
// booking link. Reads are throttled; the write is validated, throttled and
// abuse-guarded before it can touch the database.

// Must precede /salon/:salon_id so "slug" isn't captured as a salon_id.
router.get("/salon/slug/:slug", bookingReadRateLimit, bookingsController.getSalonBySlug);
router.get("/salon/:salon_id", bookingReadRateLimit, bookingsController.getSalonDetails);
router.get(
  "/salon/:salon_id/availability",
  bookingReadRateLimit,
  validateAvailabilityQuery,
  bookingsController.getAvailability
);

// Rate limit first: a rejected flood shouldn't get as far as parsing, and
// validation errors shouldn't be a cheap way to probe without consuming points.
router.post("/", bookingWriteRateLimit, validateCreateBooking, bookingsController.createBooking);

// Client self-service — authorized by a signed token, not a login session.
router.get("/manage/:appointmentId", bookingReadRateLimit, bookingsController.getManagedBooking);
router.post(
  "/manage/:appointmentId/cancel",
  bookingWriteRateLimit,
  validateManageToken,
  validateCancel,
  bookingsController.cancelManagedBooking
);
router.patch(
  "/manage/:appointmentId/reschedule",
  bookingWriteRateLimit,
  validateManageToken,
  validateReschedule,
  bookingsController.rescheduleManagedBooking
);

export default router;
