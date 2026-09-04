import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware, superAdminMiddleware } from "../../middleware/role.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { spotlightController } from "./spotlight.controller";

const router = Router();

// ── Superadmin: manage (create/edit/publish/delete, sees draft+archived) ────
// Moved from owner/admin to super_admin-only — Spotlight announcements are
// authored by the platform team, not individual salons; a salon_owner
// should only ever see already-published features via the salon-facing
// routes below.
router.post("/upload-image", authMiddleware, superAdminMiddleware, uploadMiddleware.single("image"), spotlightController.uploadImage);
router.get("/admin", authMiddleware, superAdminMiddleware, spotlightController.adminList);
router.get("/admin/:id", authMiddleware, superAdminMiddleware, spotlightController.adminGetById);
router.post("/admin", authMiddleware, superAdminMiddleware, spotlightController.create);
router.patch("/admin/:id", authMiddleware, superAdminMiddleware, spotlightController.update);
router.post("/admin/:id/publish", authMiddleware, superAdminMiddleware, spotlightController.publish);
router.delete("/admin/:id", authMiddleware, superAdminMiddleware, spotlightController.remove);

// ── Salon-facing: published features + this user's own explored state ──────
// Any authenticated salon user (owner, admin, or staff) — matches the
// existing SpotlightListPage, which every role can browse.
const anySalonUser = roleMiddleware("salon_owner", "admin", "staff");
router.get("/", authMiddleware, anySalonUser, spotlightController.list);
router.post("/:id/explore", authMiddleware, anySalonUser, spotlightController.markExplored);

export default router;
