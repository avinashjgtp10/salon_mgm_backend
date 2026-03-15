"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const calendar_controller_1 = require("./calendar.controller");
const calendar_validator_1 = require("./calendar.validator");
const router = (0, express_1.Router)();
// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.post("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_validator_1.validateCreateAppointment, calendar_controller_1.calendarController.create);
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_controller_1.calendarController.list);
router.get("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_controller_1.calendarController.getById);
router.patch("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_validator_1.validateUpdateAppointment, calendar_controller_1.calendarController.update);
// ─── Status Transitions (POST — matching your Postman) ────────────────────────
router.post("/:id/confirm", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_controller_1.calendarController.confirm);
router.post("/:id/start", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_controller_1.calendarController.start);
router.post("/:id/cancel", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_controller_1.calendarController.cancel);
router.post("/:id/no-show", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_controller_1.calendarController.noShow);
// ─── Checkout ─────────────────────────────────────────────────────────────────
router.post("/:id/checkout", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), calendar_validator_1.validateCheckoutAppointment, calendar_controller_1.calendarController.checkout);
exports.default = router;
//# sourceMappingURL=calendar.routes.js.map