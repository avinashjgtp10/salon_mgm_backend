"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const upload_middleware_1 = require("../../middleware/upload.middleware");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const products_controller_1 = require("./products.controller");
const products_validator_1 = require("./products.validator");
const router = (0, express_1.Router)();
// Brands
router.get("/brands", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_controller_1.brandsController.list);
router.get("/brands/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_controller_1.brandsController.getById);
router.post("/brands", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_validator_1.validateCreateBrand, products_controller_1.brandsController.create);
router.patch("/brands/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_validator_1.validateUpdateBrand, products_controller_1.brandsController.update);
router.delete("/brands/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), products_controller_1.brandsController.delete);
// Products
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_controller_1.productsController.list);
router.get("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_controller_1.productsController.getById);
router.post("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), upload_middleware_1.uploadMiddleware.array("photos", 5), products_validator_1.validateCreateProduct, products_controller_1.productsController.create);
router.patch("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_validator_1.validateUpdateProduct, products_controller_1.productsController.update);
router.delete("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin"), products_controller_1.productsController.delete);
// Product Photos
router.post("/:id/photos", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), upload_middleware_1.uploadMiddleware.array("photos", 5), products_controller_1.productsController.uploadPhotos);
router.put("/:id/photos/reorder", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_validator_1.validateReorderPhotos, products_controller_1.productsController.reorderPhotos);
router.delete("/:id/photos/:photoId", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("salon_owner", "admin", "staff"), products_controller_1.productsController.deletePhoto);
exports.default = router;
//# sourceMappingURL=products.routes.js.map