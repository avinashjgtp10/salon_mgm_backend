"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const webhooks_controller_1 = require("./webhooks.controller");
const router = (0, express_1.Router)();
// Public — Meta calls these (no auth)
router.get('/:salonId/meta', webhooks_controller_1.webhooksController.verify);
router.post('/:salonId/meta', webhooks_controller_1.webhooksController.handle);
// Private — frontend polling
router.get('/events', auth_middleware_1.authMiddleware, webhooks_controller_1.webhooksController.getEvents);
exports.default = router;
//# sourceMappingURL=webhooks.routes.js.map