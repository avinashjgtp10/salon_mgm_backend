"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const validation_middleware_1 = require("../../middleware/validation.middleware");
const profile_controller_1 = require("./profile.controller");
const profile_validator_1 = require("./profile.validator");
const router = (0, express_1.Router)();
// GET  /api/v1/profile/:id  — fetch profile by user ID
router.get("/:id", auth_middleware_1.authMiddleware, profile_controller_1.profileController.getProfile);
// PUT  /api/v1/profile/:id  — replace profile fields by user ID (validated)
router.put("/:id", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validateBody)(profile_validator_1.updateProfileBodySchema), profile_controller_1.profileController.updateProfile);
exports.default = router;
//# sourceMappingURL=profile.routes.js.map