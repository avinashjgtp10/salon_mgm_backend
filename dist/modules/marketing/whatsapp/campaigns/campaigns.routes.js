"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const role_middleware_1 = require("../../../../middleware/role.middleware");
const campaigns_controller_1 = require("./campaigns.controller");
const campaigns_validator_1 = require("./campaigns.validator");
const router = (0, express_1.Router)();
// GET /api/v1/campaigns
router.get('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_controller_1.campaignsController.getAll);
// GET /api/v1/campaigns/:id
router.get('/:id', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_controller_1.campaignsController.getById);
// POST /api/v1/campaigns
router.post('/', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_validator_1.validateCreateCampaign, campaigns_controller_1.campaignsController.create);
// POST /api/v1/campaigns/:id/pause
router.post('/:id/pause', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_controller_1.campaignsController.pause);
// POST /api/v1/campaigns/:id/resume
router.post('/:id/resume', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_controller_1.campaignsController.resume);
// GET /api/v1/campaigns/:id/contacts
router.get('/:id/contacts', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_controller_1.campaignsController.getContacts);
// GET /api/v1/campaigns/:id/report/:type
router.get('/:id/report/:type', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), campaigns_controller_1.campaignsController.getReport);
exports.default = router;
//# sourceMappingURL=campaigns.routes.js.map