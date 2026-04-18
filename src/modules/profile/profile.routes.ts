import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateBody } from "../../middleware/validation.middleware";
import { profileController } from "./profile.controller";
import { updateProfileBodySchema } from "./profile.validator";

const router = Router();

// GET  /api/v1/profile/:id  — fetch profile by user ID
router.get("/:id", authMiddleware, profileController.getProfile);

// PUT  /api/v1/profile/:id  — replace profile fields by user ID (validated)
router.put(
  "/:id",
  authMiddleware,
  validateBody(updateProfileBodySchema),
  profileController.updateProfile,
);

export default router;
