"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/modules/memberships/memberships.routes.ts
const express_1 = require("express");
const memberships_controller_1 = require("./memberships.controller");
const memberships_validator_1 = require("./memberships.validator");
const router = (0, express_1.Router)();
router.get("/", memberships_validator_1.validateMembershipsListQuery, memberships_controller_1.membershipsController.list);
router.post("/", memberships_validator_1.validateCreateMembership, memberships_controller_1.membershipsController.create);
router.get("/:id", memberships_controller_1.membershipsController.getById);
router.patch("/:id", memberships_validator_1.validateUpdateMembership, memberships_controller_1.membershipsController.update);
router.delete("/:id", memberships_controller_1.membershipsController.delete);
exports.default = router;
//# sourceMappingURL=memberships.routes.js.map