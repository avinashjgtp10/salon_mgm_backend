"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const role_middleware_1 = require("../../../../middleware/role.middleware");
const dashboard_controller_1 = require("./dashboard.controller");
const router = (0, express_1.Router)();
router.get('/stats', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), dashboard_controller_1.dashboardController.getStats);
exports.default = router;
//# sourceMappingURL=dashboard.routes.js.map