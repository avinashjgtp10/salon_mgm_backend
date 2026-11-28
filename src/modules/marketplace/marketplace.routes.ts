import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireModule } from "../../middleware/moduleLock.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { uploadMiddleware } from "../../middleware/upload.middleware";
import { marketplaceController } from "./marketplace.controller";
import { onboardingController } from "./onboarding.controller";
import {
  validateUpsertEssentials, validateUpsertAbout,
  validateUpsertLocation, validateUpsertWorkingHours,
  validateAddImage, validateReorderImages, validateUpsertFeatures,
  validateUpsertBookingPolicy, validateSetStaffVisibility, validateUpsertTheme, validateUpsertHeadline,
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

router.use(authMiddleware, requireModule("online_booking"));

// ── Marketplace add-on: onboarding ───────────────────────────────────────────
// Changing the salon's own record (name, description) or submitting and accepting terms is the owner's or an
// admin's job, the same rule as PATCH /salons/:id. Assigning services to staff changes the catalog's own mapping,
// so it also needs the catalog's edit permission.
const ownerOrAdmin = roleMiddleware("salon_owner", "admin");
router.get("/onboarding",                          auth, ownerAdminStaff, viewMarketplace,   onboardingController.getState);
router.get("/onboarding/preview",                  auth, ownerAdminStaff, viewMarketplace,   onboardingController.preview);
router.put("/onboarding/step",                     auth, ownerAdminStaff, manageMarketplace, onboardingController.setStep);
router.put("/onboarding/business",                 auth, ownerOrAdmin,    manageMarketplace, onboardingController.saveBusiness);
router.put("/onboarding/location",                 auth, ownerAdminStaff, manageMarketplace, onboardingController.confirmLocation);
router.patch("/onboarding/photos/:imageId",        auth, ownerAdminStaff, manageMarketplace, onboardingController.setPhotoCategory);
router.put("/onboarding/services",                 auth, ownerAdminStaff, manageMarketplace, onboardingController.saveServices);
router.put("/onboarding/availability",             auth, ownerAdminStaff, manageMarketplace, onboardingController.saveAvailability);
router.put("/onboarding/staff/:staffId/services",  auth, ownerAdminStaff, manageMarketplace, requirePermission("edit_services"), onboardingController.assignStaffServices);
router.put("/onboarding/preferences",              auth, ownerAdminStaff, manageMarketplace, onboardingController.savePreferences);
router.post("/onboarding/submit",                  auth, ownerOrAdmin,    manageMarketplace, onboardingController.submit);

// ── Full profile ──────────────────────────────────────────────────────────────
router.get("/profile",          auth, ownerAdminStaff, viewMarketplace, marketplaceController.getProfile);

// ── Essentials & About ────────────────────────────────────────────────────────
router.put("/essentials",       auth, ownerAdminStaff, manageMarketplace, validateUpsertEssentials, marketplaceController.upsertEssentials);
router.put("/about",            auth, ownerAdminStaff, manageMarketplace, validateUpsertAbout,      marketplaceController.upsertAbout);
router.put("/booking-policy",   auth, ownerAdminStaff, manageMarketplace, validateUpsertBookingPolicy, marketplaceController.upsertBookingPolicy);
router.put("/theme",            auth, ownerAdminStaff, manageMarketplace, validateUpsertTheme,         marketplaceController.upsertTheme);
router.put("/headline",         auth, ownerAdminStaff, manageMarketplace, validateUpsertHeadline,      marketplaceController.upsertHeadline);

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

// ── Staff Visibility ─────────────────────────────────────────────────────────
router.get("/staff-visibility", auth, ownerAdminStaff, viewMarketplace, marketplaceController.getStaffVisibility);
router.put("/staff-visibility", auth, ownerAdminStaff, manageMarketplace, validateSetStaffVisibility, marketplaceController.setStaffVisibility);

// ── Publish / Unpublish ───────────────────────────────────────────────────────
router.post("/publish",         auth, ownerAdminStaff, manageMarketplace, marketplaceController.publish);
router.post("/unpublish",       auth, ownerAdminStaff, manageMarketplace, marketplaceController.unpublish);

export default router;
