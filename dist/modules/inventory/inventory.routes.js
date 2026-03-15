"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const inventory_controller_1 = require("./inventory.controller");
const inventory_validator_1 = require("./inventory.validator");
const router = (0, express_1.Router)();
// ─── Suppliers ────────────────────────────────────────────────────────────────
router.post("/suppliers", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), inventory_validator_1.validateCreateSupplier, inventory_controller_1.suppliersController.create);
router.get("/suppliers", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), inventory_controller_1.suppliersController.list);
router.get("/suppliers/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), inventory_controller_1.suppliersController.getById);
router.patch("/suppliers/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), inventory_validator_1.validateUpdateSupplier, inventory_controller_1.suppliersController.update);
router.delete("/suppliers/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), inventory_controller_1.suppliersController.delete);
// ─── Stock Movements ──────────────────────────────────────────────────────────
router.post("/stock-movements", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), inventory_validator_1.validateCreateStockMovement, inventory_controller_1.stockMovementsController.create);
router.get("/stock-movements", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), inventory_controller_1.stockMovementsController.list);
router.get("/stock-movements/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), inventory_controller_1.stockMovementsController.getById);
// ─── Stock Take ───────────────────────────────────────────────────────────────
router.post("/stock-take", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), inventory_validator_1.validateStockTake, inventory_controller_1.stockTakeController.process);
exports.default = router;
//# sourceMappingURL=inventory.routes.js.map