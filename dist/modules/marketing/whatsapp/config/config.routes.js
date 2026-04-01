"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const config_controller_1 = require("./config.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.get('/', config_controller_1.configController.getConfig);
router.post('/', config_controller_1.configController.saveConfig);
router.post('/test', config_controller_1.configController.testConnection);
exports.default = router;
//# sourceMappingURL=config.routes.js.map