"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_controller_1 = require("./users.controller");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const role_middleware_2 = require("../../middleware/role.middleware");
const upload_middleware_1 = require("../../middleware/upload.middleware");
const validation_middleware_1 = require("../../middleware/validation.middleware");
const users_validator_1 = require("./users.validator");
const router = (0, express_1.Router)();
// ── Self endpoints (must come before /:id to avoid "me" being parsed as id) ──
// GET  /api/v1/users/me  — get own profile
router.get("/me", auth_middleware_1.authMiddleware, users_controller_1.usersController.me);
// PATCH /api/v1/users/me — update own profile (validated)
router.patch("/me", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validateBody)(users_validator_1.updateUserSchema.shape.body), users_controller_1.usersController.updateMe);
// POST /api/v1/users/me/change-password — change own password (validated)
router.post("/me/change-password", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validateBody)(users_validator_1.changePasswordSchema), users_controller_1.usersController.changePassword);
// POST /api/v1/users/me/avatar — upload profile photo (multer → S3)
router.post("/me/avatar", auth_middleware_1.authMiddleware, upload_middleware_1.uploadMiddleware.single("avatar"), users_controller_1.usersController.uploadAvatar);
// ── Admin endpoints ────────────────────────────────────────────────────────────
// GET /api/v1/users — list all users (admin only)
router.get("/", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin"), users_controller_1.usersController.list);
// GET /api/v1/users/:id
router.get("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin", "salon_owner"), users_controller_1.usersController.getById);
// PATCH /api/v1/users/:id/role — update role (admin only)
router.patch("/:id/role", auth_middleware_1.authMiddleware, (0, role_middleware_2.protect)("admin"), users_controller_1.usersController.updateRole);
// PATCH /api/v1/users/:id — admin update any user
router.patch("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin"), users_controller_1.usersController.update);
// DELETE /api/v1/users/:id — admin delete user
router.delete("/:id", auth_middleware_1.authMiddleware, (0, role_middleware_1.roleMiddleware)("admin"), users_controller_1.usersController.remove);
exports.default = router;
//# sourceMappingURL=users.routes.js.map