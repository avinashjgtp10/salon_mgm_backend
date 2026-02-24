import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { staffController } from "./staff.controller";
import {
    validateCreateStaff,
    validateCreateStaffLeave,
    validateCreateStaffSchedule,
    validateUpdateStaff,
    validateUpdateStaffLeave,
    validateUpdateStaffSchedule,
} from "./staff.validator";

const router = Router();

// STAFF CRUD
router.post("/", authMiddleware, roleMiddleware("salon_owner", "admin"), validateCreateStaff, staffController.create);

router.get("/", authMiddleware, roleMiddleware("salon_owner", "admin"), staffController.listBySalon);

router.get("/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), staffController.getById);

router.patch("/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), validateUpdateStaff, staffController.update);

router.delete("/:id", authMiddleware, roleMiddleware("salon_owner", "admin"), staffController.remove);

// SCHEDULES
router.get("/:id/schedules", authMiddleware, roleMiddleware("salon_owner", "admin"), staffController.getSchedules);

router.post(
    "/:id/schedules",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateCreateStaffSchedule,
    staffController.upsertSchedule
);

router.patch(
    "/schedules/:scheduleId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateStaffSchedule,
    staffController.updateSchedule
);

router.delete(
    "/schedules/:scheduleId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    staffController.removeSchedule
);

// LEAVES
router.get("/:id/leaves", authMiddleware, roleMiddleware("salon_owner", "admin"), staffController.listLeaves);

router.post(
    "/:id/leaves",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateCreateStaffLeave,
    staffController.createLeave
);

router.patch(
    "/leaves/:leaveId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateStaffLeave,
    staffController.updateLeave
);

router.delete(
    "/leaves/:leaveId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    staffController.removeLeave
);

export default router;
