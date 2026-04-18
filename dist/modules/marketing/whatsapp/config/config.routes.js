"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const role_middleware_1 = require("../../../../middleware/role.middleware");
const config_controller_1 = require("./config.controller");
const config_validator_1 = require("./config.validator");
const router = (0, express_1.Router)();
// GET /api/v1/wa-config
router.get('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), config_controller_1.configController.getConfig);
// PUT /api/v1/wa-config
router.put('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), config_validator_1.validateSaveConfig, config_controller_1.configController.saveConfig);
// POST /api/v1/wa-config/test
router.post('/test', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), config_controller_1.configController.testConnection);
exports.default = router;
//# sourceMappingURL=config.routes.js.map