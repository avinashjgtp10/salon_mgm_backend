import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { blockedTimesController } from "./blocked_times.controller";
import { validateCreateBlockedTime, validateUpdateBlockedTime } from "./blocked_times.validator";

const router = Router();

router.post(
  "/",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  validateCreateBlockedTime,
  blockedTimesController.create
);

router.get(
  "/",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  blockedTimesController.list
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  blockedTimesController.getById
);

router.patch(
  "/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  validateUpdateBlockedTime,
  blockedTimesController.update
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("salon_owner", "admin", "staff"),
  blockedTimesController.delete
);

export default router;
