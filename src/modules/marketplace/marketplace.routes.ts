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
// Previously owner/admin-only with no permission check at all, making
// view_booking/manage_booking (already in the catalog since Phase 1) dead
// for this module. Opened to staff this phase.
const ownerAdminStaff = roleMiddleware("salon_owner", "admin", "staff");
const viewBooking = requirePermission("view_booking");
const manageBooking = requirePermission("manage_booking");

// featureKey "online_booking" — Basic tier and up by default, revocable per
// salon via feature_overrides.
router.use(authMiddleware, requirePlanFeature("online_booking"));

// ── Full profile ──────────────────────────────────────────────────────────────
router.get("/profile",          auth, ownerAdminStaff, viewBooking, marketplaceController.getProfile);

// ── Essentials & About ────────────────────────────────────────────────────────
router.put("/essentials",       auth, ownerAdminStaff, manageBooking, validateUpsertEssentials, marketplaceController.upsertEssentials);
router.put("/about",            auth, ownerAdminStaff, manageBooking, validateUpsertAbout,      marketplaceController.upsertAbout);
router.put("/booking-policy",   auth, ownerAdminStaff, manageBooking, validateUpsertBookingPolicy, marketplaceController.upsertBookingPolicy);

// ── Location ──────────────────────────────────────────────────────────────────
router.get("/location",         auth, ownerAdminStaff, viewBooking, marketplaceController.getLocation);
router.put("/location",         auth, ownerAdminStaff, manageBooking, validateUpsertLocation,    marketplaceController.upsertLocation);

// ── Opening Hours ─────────────────────────────────────────────────────────────
router.get("/working-hours",    auth, ownerAdminStaff, viewBooking, marketplaceController.getWorkingHours);
router.put("/working-hours",    auth, ownerAdminStaff, manageBooking, validateUpsertWorkingHours, marketplaceController.upsertWorkingHours);

// ── Venue Images ──────────────────────────────────────────────────────────────
router.get("/images",                  auth, ownerAdminStaff, viewBooking, marketplaceController.getImages);
router.post("/images",                 auth, ownerAdminStaff, manageBooking, uploadMiddleware.single("image"), validateAddImage, marketplaceController.addImage);
router.patch("/images/reorder",        auth, ownerAdminStaff, manageBooking, validateReorderImages,  marketplaceController.reorderImages);
router.patch("/images/:imageId/cover", auth, ownerAdminStaff, manageBooking, marketplaceController.setCoverImage);
router.delete("/images/:imageId",      auth, ownerAdminStaff, manageBooking, marketplaceController.deleteImage);

// ── Logo & Cover ─────────────────────────────────────────────────────────────
router.post("/logo",  auth, ownerAdminStaff, manageBooking, uploadMiddleware.single("image"), marketplaceController.uploadLogo);
router.post("/cover", auth, ownerAdminStaff, manageBooking, uploadMiddleware.single("image"), marketplaceController.uploadCover);

// ── Amenities & Highlights ────────────────────────────────────────────────────
router.get("/features",         auth, ownerAdminStaff, viewBooking, marketplaceController.getFeatures);
router.put("/features",         auth, ownerAdminStaff, manageBooking, validateUpsertFeatures,    marketplaceController.upsertFeatures);

// ── Publish / Unpublish ───────────────────────────────────────────────────────
router.post("/publish",         auth, ownerAdminStaff, manageBooking, marketplaceController.publish);
router.post("/unpublish",       auth, ownerAdminStaff, manageBooking, marketplaceController.unpublish);

export default router;
