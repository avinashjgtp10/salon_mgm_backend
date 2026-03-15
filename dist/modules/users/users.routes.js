"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_controller_1 = require("./users.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const role_middleware_2 = require("../../middleware/role.middleware");
const router = (0, express_1.Router)();
// Only logged-in users
router.get("/me", auth_middleware_1.authMiddleware, users_controller_1.usersController.me);
// Only ADMIN can list all users
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin"), users_controller_1.usersController.list);
// Admin OR salon owner can view user by id
router.get("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin", "salon_owner"), users_controller_1.usersController.getById);
router.patch("/:id/role", auth_middleware_1.authMiddleware, (0, role_middleware_2.protect)("admin"), users_controller_1.usersController.updateRole);
// Only admin can delete users
router.delete("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin"), users_controller_1.usersController.remove);
exports.default = router;
//# sourceMappingURL=users.routes.js.map