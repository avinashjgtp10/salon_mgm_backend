"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const sales_controller_1 = require("./sales.controller");
const sales_validator_1 = require("./sales.validator");
const router = (0, express_1.Router)();
router.post("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), sales_validator_1.validateCreateSale, sales_controller_1.salesController.create);
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), sales_controller_1.salesController.list);
router.get("/summary", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), sales_controller_1.salesController.getDailySummary);
router.get("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff", "client"), sales_controller_1.salesController.getById);
router.patch("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), sales_validator_1.validateUpdateSale, sales_controller_1.salesController.update);
router.post("/:id/checkout", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), sales_validator_1.validateCheckoutSale, sales_controller_1.salesController.checkout);
exports.default = router;
//# sourceMappingURL=sales.routes.js.map