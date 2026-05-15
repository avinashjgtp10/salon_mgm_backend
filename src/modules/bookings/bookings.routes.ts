import { Router } from "express";
import { bookingsController } from "./bookings.controller";

const router = Router();

router.get("/salon/:salon_id", bookingsController.getSalonDetails);
router.post("/", bookingsController.createBooking);

export default router;
