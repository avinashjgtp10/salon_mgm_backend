
import { Router } from "express";
import { usersController } from "./users.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { protect } from "../../middleware/role.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { validateBody } from "../../middleware/validation.middleware";
import { updateUserSchema, changePasswordSchema } from "./users.validator";

const router = Router();

// ── Self endpoints (must come before /:id to avoid "me" being parsed as id) ──

// GET  /api/v1/users/me  — get own profile
router.get("/me", authMiddleware, usersController.me);

// PATCH /api/v1/users/me — update own profile (validated)
router.patch(
  "/me",
  authMiddleware,
  validateBody(updateUserSchema.shape.body),
  usersController.updateMe,
);

// POST /api/v1/users/me/change-password — change own password (validated)
router.post(
  "/me/change-password",
  authMiddleware,
  validateBody(changePasswordSchema),
  usersController.changePassword,
);

// POST /api/v1/users/me/avatar — upload profile photo (multer → S3)
router.post(
  "/me/avatar",
  authMiddleware,
  uploadMiddleware.single("avatar"),
  usersController.uploadAvatar,
);

// ── Admin endpoints ────────────────────────────────────────────────────────────

// GET /api/v1/users — list all users (admin only)
router.get(
  "/",
  authMiddleware,
  roleMiddleware("admin"),
  usersController.list,
);

// GET /api/v1/users/:id
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("admin", "salon_owner"),
  usersController.getById,
);

// PATCH /api/v1/users/:id/role — update role (admin only)
router.patch("/:id/role", authMiddleware, protect("admin"), usersController.updateRole);

// PATCH /api/v1/users/:id — admin update any user
router.patch("/:id", authMiddleware, roleMiddleware("admin"), usersController.update);

// DELETE /api/v1/users/:id — admin delete user
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware("admin"),
  usersController.remove,
);

export default router;
