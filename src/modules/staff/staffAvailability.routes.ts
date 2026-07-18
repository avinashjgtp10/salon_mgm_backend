import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { staffAvailabilityController } from "./staffAvailability.controller";
import { validateStaffAvailability } from "./staffAvailability.validator";

const router = Router();

router.get(
  "/:staffId/availability",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  validateStaffAvailability,
  staffAvailabilityController.get,
);

export default router;
