"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/modules/clients/clients.routes.ts
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const clients_controller_1 = require("./clients.controller");
const clients_upload_1 = require("./clients.upload");
const clients_validator_1 = require("./clients.validator");
const router = (0, express_1.Router)();
// LIST + CREATE
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateClientsListQuery, clients_controller_1.clientsController.list);
router.post("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateCreateClient, clients_controller_1.clientsController.create);
// EXPORT (same filters)
router.get("/export", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateClientsListQuery, clients_controller_1.clientsController.export);
// IMPORT
router.post("/import", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_upload_1.upload.single("file"), clients_controller_1.clientsController.import);
// GET  /api/v1/clients/duplicates?phone_number=...
router.get("/duplicates", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_controller_1.clientsController.findDuplicates);
// MERGE
router.post("/merge", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateMergeClients, clients_controller_1.clientsController.merge);
router.post("/merge-duplicates", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_controller_1.clientsController.mergeAllDuplicates);
// BLOCK
router.post("/block", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateBlockClients, clients_controller_1.clientsController.block);
router.patch("/block", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateBlockClients, clients_controller_1.clientsController.block);
// GET/UPDATE/DELETE by id
router.get("/:clientId", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_controller_1.clientsController.getById);
router.patch("/:clientId", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_validator_1.validateUpdateClient, clients_controller_1.clientsController.update);
router.delete("/:clientId", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), clients_controller_1.clientsController.remove);
exports.default = router;
//# sourceMappingURL=clients.routes.js.map