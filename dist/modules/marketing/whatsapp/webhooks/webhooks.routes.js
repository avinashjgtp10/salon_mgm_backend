"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const role_middleware_1 = require("../../../../middleware/role.middleware");
const webhooks_controller_1 = require("./webhooks.controller");
const router = (0, express_1.Router)();
// Public — Meta calls these (no auth)
// GET  /api/v1/webhooks/:salonId/meta
router.get('/:salonId/meta', webhooks_controller_1.webhooksController.verify);
// POST /api/v1/webhooks/:salonId/meta
router.post('/:salonId/meta', webhooks_controller_1.webhooksController.handle);
// Private — frontend polling
// GET /api/v1/webhooks/events
router.get('/events', auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)('salon_owner', 'admin'), webhooks_controller_1.webhooksController.getEvents);
exports.default = router;
//# sourceMappingURL=webhooks.routes.js.map