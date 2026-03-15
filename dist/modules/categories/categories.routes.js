"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const categories_controller_1 = require("./categories.controller");
const categories_validator_1 = require("./categories.validator");
const router = (0, express_1.Router)();
/**
 * Categories routes
 * Base: /api/v1/categories
 * JWT only (authMiddleware). No roleMiddleware.
 */
router.post("/", auth_middleware_1.authMiddleware, categories_validator_1.validateCreateCategory, categories_controller_1.categoriesController.create);
router.get("/", auth_middleware_1.authMiddleware, categories_controller_1.categoriesController.list);
router.get("/:id", auth_middleware_1.authMiddleware, categories_controller_1.categoriesController.getById);
router.patch("/:id", auth_middleware_1.authMiddleware, categories_validator_1.validateUpdateCategory, categories_controller_1.categoriesController.update);
router.delete("/:id", auth_middleware_1.authMiddleware, categories_controller_1.categoriesController.remove);
exports.default = router;
//# sourceMappingURL=categories.routes.js.map