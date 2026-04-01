"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../../../middleware/auth.middleware");
const templates_controller_1 = require("./templates.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.get('/', templates_controller_1.templatesController.getAll);
router.get('/:id', templates_controller_1.templatesController.getById);
router.post('/', templates_controller_1.templatesController.create);
router.post('/:id/sync', templates_controller_1.templatesController.syncStatus);
router.delete('/:id', templates_controller_1.templatesController.delete);
exports.default = router;
//# sourceMappingURL=templates.routes.js.map