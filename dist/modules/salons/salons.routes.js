"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const salons_controller_1 = require("./salons.controller");
const salons_validator_1 = require("./salons.validator");
const router = (0, express_1.Router)();
router.post("/", auth_middleware_1.authMiddleware, salons_validator_1.validateCreateSalon, salons_controller_1.salonsController.create);
router.get("/me", auth_middleware_1.authMiddleware, salons_controller_1.salonsController.mySalon);
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin"), salons_controller_1.salonsController.listAll);
router.get("/:id", auth_middleware_1.authMiddleware, salons_controller_1.salonsController.getById);
router.patch("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), salons_validator_1.validateUpdateSalon, salons_controller_1.salonsController.update);
exports.default = router;
//# sourceMappingURL=salons.routes.js.map