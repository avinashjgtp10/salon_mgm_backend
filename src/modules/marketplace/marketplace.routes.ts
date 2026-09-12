import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { requirePlanFeature } from "../../middleware/planFeature.middleware";
import { marketplaceController } from "./marketplace.controller";
import {
  validateUpsertEssentials, validateUpsertAbout,
  validateUpsertLocation, validateUpsertWorkingHours,
  validateAddImage, validateReorderImages, validateUpsertFeatures,
  validateUpsertBookingPolicy,
} from "./marketplace.validator";

const router  = Router();
const auth    = authMiddleware;
// Previously owner/admin-only, gated by the module-wide view_booking/
// manage_booking. Online Booking Channels ticket split both into this
// channel's own view_marketplace/manage_marketplace (view_booking survives
// separately as the outer "can enter Online Booking at all" master switch —
// see usePermissions.ts; manage_booking was deleted outright since its
// entire real scope transfers 1:1 to manage_marketplace).
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
const viewMarketplace = requirePermission("view_marketplace");
const manageMarketplace = requirePermission("manage_marketplace");

// featureKey "online_booking" — Basic tier and up by default, revocable per
// salon via feature_overrides.
router.use(authMiddleware, requirePlanFeature("online_booking"));

// ── Full profile ──────────────────────────────────────────────────────────────
router.get("/profile",          auth, ownerAdminStaff, viewMarketplace, marketplaceController.getProfile);

// ── Essentials & About ────────────────────────────────────────────────────────
router.put("/essentials",       auth, ownerAdminStaff, manageMarketplace, validateUpsertEssentials, marketplaceController.upsertEssentials);
router.put("/about",            auth, ownerAdminStaff, manageMarketplace, validateUpsertAbout,      marketplaceController.upsertAbout);
router.put("/booking-policy",   auth, ownerAdminStaff, manageMarketplace, validateUpsertBookingPolicy, marketplaceController.upsertBookingPolicy);

// ── Location ──────────────────────────────────────────────────────────────────
router.get("/location",         auth, ownerAdminStaff, viewMarketplace, marketplaceController.getLocation);
router.put("/location",         auth, ownerAdminStaff, manageMarketplace, validateUpsertLocation,    marketplaceController.upsertLocation);

// ── Opening Hours ─────────────────────────────────────────────────────────────
router.get("/working-hours",    auth, ownerAdminStaff, viewMarketplace, marketplaceController.getWorkingHours);
router.put("/working-hours",    auth, ownerAdminStaff, manageMarketplace, validateUpsertWorkingHours, marketplaceController.upsertWorkingHours);

// ── Venue Images ──────────────────────────────────────────────────────────────
router.get("/images",                  auth, ownerAdminStaff, viewMarketplace, marketplaceController.getImages);
router.post("/images",                 auth, ownerAdminStaff, manageMarketplace, uploadMiddleware.single("image"), validateAddImage, marketplaceController.addImage);
router.patch("/images/reorder",        auth, ownerAdminStaff, manageMarketplace, validateReorderImages,  marketplaceController.reorderImages);
router.patch("/images/:imageId/cover", auth, ownerAdminStaff, manageMarketplace, marketplaceController.setCoverImage);
router.delete("/images/:imageId",      auth, ownerAdminStaff, manageMarketplace, marketplaceController.deleteImage);

// ── Logo & Cover ─────────────────────────────────────────────────────────────
router.post("/logo",  auth, ownerAdminStaff, manageMarketplace, uploadMiddleware.single("image"), marketplaceController.uploadLogo);
router.post("/cover", auth, ownerAdminStaff, manageMarketplace, uploadMiddleware.single("image"), marketplaceController.uploadCover);

// ── Amenities & Highlights ────────────────────────────────────────────────────
router.get("/features",         auth, ownerAdminStaff, viewMarketplace, marketplaceController.getFeatures);
router.put("/features",         auth, ownerAdminStaff, manageMarketplace, validateUpsertFeatures,    marketplaceController.upsertFeatures);

// ── Publish / Unpublish ───────────────────────────────────────────────────────
router.post("/publish",         auth, ownerAdminStaff, manageMarketplace, marketplaceController.publish);
router.post("/unpublish",       auth, ownerAdminStaff, manageMarketplace, marketplaceController.unpublish);

export default router;
