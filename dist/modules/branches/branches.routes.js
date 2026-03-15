"use strict";
// src/modules/branches/branches.routes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const branches_controller_1 = require("./branches.controller");
const branches_validator_1 = require("./branches.validator");
const router = (0, express_1.Router)();
// ---------- BRANCH ----------
router.post("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateCreateBranch, branches_controller_1.branchesController.create);
router.get("/by-salon/:salonId", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_controller_1.branchesController.listBySalon);
router.get("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_controller_1.branchesController.getById);
router.patch("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateUpdateBranch, branches_controller_1.branchesController.update);
// ---------- TIMINGS ----------
router.post("/:id/timings", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateSetTimings, branches_controller_1.branchesController.setTimings);
router.get("/:id/timings", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_controller_1.branchesController.getTimings);
router.put("/:id/timings", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateReplaceTimings, branches_controller_1.branchesController.replaceTimings);
// ---------- HOLIDAYS ----------
router.post("/:id/holidays", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateCreateHoliday, branches_controller_1.branchesController.createHoliday);
router.get("/:id/holidays", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateHolidayListQuery, branches_controller_1.branchesController.listHolidays);
// ✅ delete uses /holidays/:holidayId (global)
router.delete("/holidays/:holidayId", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), branches_validator_1.validateDeleteHoliday, branches_controller_1.branchesController.deleteHoliday);
exports.default = router;
//# sourceMappingURL=branches.routes.js.map