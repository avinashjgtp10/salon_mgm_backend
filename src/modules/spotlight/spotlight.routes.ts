import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { spotlightController } from "./spotlight.controller";

const router = Router();
const ownerAdmin = roleMiddleware("salon_owner", "admin");

// Spotlight feature management (Manage Features) is owner/admin only in the
// frontend — mirrored here so only they can upload feature screenshots.
router.post(
  "/upload-image",
  authMiddleware,
  ownerAdmin,
  uploadMiddleware.single("image"),
  spotlightController.uploadImage
);

export default router;
