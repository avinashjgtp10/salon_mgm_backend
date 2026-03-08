import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { marketplaceController } from "./marketplace.controller";
import {
  validateUpsertEssentials, validateUpsertAbout,
  validateUpsertLocation, validateUpsertWorkingHours,
  validateAddImage, validateReorderImages, validateUpsertFeatures,
} from "./marketplace.validator";

const router  = Router();
const auth    = authMiddleware;
const ownerAdmin = roleMiddleware("salon_owner", "admin");

// ── Full profile ──────────────────────────────────────────────────────────────
router.get("/profile",          auth, ownerAdmin, marketplaceController.getProfile);

// ── Essentials & About ────────────────────────────────────────────────────────
router.put("/essentials",       auth, ownerAdmin, validateUpsertEssentials, marketplaceController.upsertEssentials);
router.put("/about",            auth, ownerAdmin, validateUpsertAbout,      marketplaceController.upsertAbout);

// ── Location ──────────────────────────────────────────────────────────────────
router.get("/location",         auth, ownerAdmin, marketplaceController.getLocation);
router.put("/location",         auth, ownerAdmin, validateUpsertLocation,    marketplaceController.upsertLocation);

// ── Opening Hours ─────────────────────────────────────────────────────────────
router.get("/working-hours",    auth, ownerAdmin, marketplaceController.getWorkingHours);
router.put("/working-hours",    auth, ownerAdmin, validateUpsertWorkingHours, marketplaceController.upsertWorkingHours);

// ── Venue Images ──────────────────────────────────────────────────────────────
router.get("/images",                  auth, ownerAdmin, marketplaceController.getImages);
router.post("/images",                 auth, ownerAdmin, validateAddImage,       marketplaceController.addImage);
router.patch("/images/reorder",        auth, ownerAdmin, validateReorderImages,  marketplaceController.reorderImages);
router.patch("/images/:imageId/cover", auth, ownerAdmin, marketplaceController.setCoverImage);
router.delete("/images/:imageId",      auth, ownerAdmin, marketplaceController.deleteImage);

// ── Amenities & Highlights ────────────────────────────────────────────────────
router.get("/features",         auth, ownerAdmin, marketplaceController.getFeatures);
router.put("/features",         auth, ownerAdmin, validateUpsertFeatures,    marketplaceController.upsertFeatures);

// ── Publish / Unpublish ───────────────────────────────────────────────────────
router.post("/publish",         auth, ownerAdmin, marketplaceController.publish);
router.post("/unpublish",       auth, ownerAdmin, marketplaceController.unpublish);

export default router;