// src/modules/branches/branches.routes.ts

import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { branchesController } from "./branches.controller";
import {
    validateCreateBranch,
    validateCreateHoliday,
    validateDeleteHoliday,
    validateHolidayListQuery,
    validateReplaceTimings,
    validateSetTimings,
    validateUpdateBranch,
} from "./branches.validator";

const router = Router();

// ---------- BRANCH ----------
router.post(
    "/",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateCreateBranch,
    branchesController.create
);

router.get(
    "/by-salon/:salonId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    branchesController.listBySalon
);

router.get(
    "/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    branchesController.getById
);

router.patch(
    "/:id",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateUpdateBranch,
    branchesController.update
);

// ---------- TIMINGS ----------
router.post(
    "/:id/timings",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateSetTimings,
    branchesController.setTimings
);

router.get(
    "/:id/timings",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    branchesController.getTimings
);

router.put(
    "/:id/timings",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateReplaceTimings,
    branchesController.replaceTimings
);

// ---------- HOLIDAYS ----------
router.post(
    "/:id/holidays",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateCreateHoliday,
    branchesController.createHoliday
);

router.get(
    "/:id/holidays",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateHolidayListQuery,
    branchesController.listHolidays
);

// ✅ delete uses /holidays/:holidayId (global)
router.delete(
    "/holidays/:holidayId",
    authMiddleware,
    roleMiddleware("salon_owner", "admin"),
    validateDeleteHoliday,
    branchesController.deleteHoliday
);

export default router;
