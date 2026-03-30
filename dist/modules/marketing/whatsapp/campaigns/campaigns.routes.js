"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const campaigns_controller_1 = require("./campaigns.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.get('/', campaigns_controller_1.campaignsController.getAll);
router.get('/:id', campaigns_controller_1.campaignsController.getById);
router.post('/', campaigns_controller_1.campaignsController.create);
router.post('/:id/pause', campaigns_controller_1.campaignsController.pause);
router.post('/:id/resume', campaigns_controller_1.campaignsController.resume);
router.get('/:id/contacts', campaigns_controller_1.campaignsController.getContacts);
router.get('/:id/report/:type', campaigns_controller_1.campaignsController.downloadReport);
exports.default = router;
//# sourceMappingURL=campaigns.routes.js.map