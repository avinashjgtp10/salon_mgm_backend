"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const role_middleware_1 = require("../../../../middleware/role.middleware");
const templates_controller_1 = require("./templates.controller");
const templates_validator_1 = require("./templates.validator");
const router = (0, express_1.Router)();
// GET /api/v1/templates
router.get('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), templates_controller_1.templatesController.getAll);
// GET /api/v1/templates/:id
router.get('/:id', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), templates_controller_1.templatesController.getById);
// POST /api/v1/templates
router.post('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), templates_validator_1.validateCreateTemplate, templates_controller_1.templatesController.create);
// POST /api/v1/templates/:id/sync
router.post('/:id/sync', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), templates_controller_1.templatesController.syncStatus);
// DELETE /api/v1/templates/:id
router.delete('/:id', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), templates_controller_1.templatesController.delete);
exports.default = router;
//# sourceMappingURL=templates.routes.js.map