// src/modules/branches/branches.routes.ts

import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
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
// Previously owner/admin-only with no permission key at all (and no
// frontend UI to reach it) — opened to staff via view_branches/
// manage_branches this phase. NOTE: a frontend screen still needs to be
// built for this to be reachable in the UI — this only closes the backend
// gap so the API is ready when that UI exists.
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
const viewBranches = requirePermission("view_branches");
const manageBranches = requirePermission("manage_branches");

// ---------- BRANCH ----------
router.post(
    "/",
    authMiddleware,
    ownerAdminStaff, manageBranches,
    validateCreateBranch,
    branchesController.create
);

router.get(
    "/by-salon/:salonId",
    authMiddleware,
    ownerAdminStaff, viewBranches,
    branchesController.listBySalon
);

router.get(
    "/:id",
    authMiddleware,
    ownerAdminStaff, viewBranches,
    branchesController.getById
);

router.patch(
    "/:id",
    authMiddleware,
    ownerAdminStaff, manageBranches,
    validateUpdateBranch,
    branchesController.update
);

// ---------- TIMINGS ----------
router.post(
    "/:id/timings",
    authMiddleware,
    ownerAdminStaff, manageBranches,
    validateSetTimings,
    branchesController.setTimings
);

router.get(
    "/:id/timings",
    authMiddleware,
    ownerAdminStaff, viewBranches,
    branchesController.getTimings
);

router.put(
    "/:id/timings",
    authMiddleware,
    ownerAdminStaff, manageBranches,
    validateReplaceTimings,
    branchesController.replaceTimings
);

// ---------- HOLIDAYS ----------
router.post(
    "/:id/holidays",
    authMiddleware,
    ownerAdminStaff, manageBranches,
    validateCreateHoliday,
    branchesController.createHoliday
);

router.get(
    "/:id/holidays",
    authMiddleware,
    ownerAdminStaff, viewBranches,
    validateHolidayListQuery,
    branchesController.listHolidays
);

// ✅ delete uses /holidays/:holidayId (global)
router.delete(
    "/holidays/:holidayId",
    authMiddleware,
    ownerAdminStaff, manageBranches,
    validateDeleteHoliday,
    branchesController.deleteHoliday
);

export default router;
