"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middleware/auth.middleware");
const role_middleware_1 = require("../../middleware/role.middleware");
const marketplace_controller_1 = require("./marketplace.controller");
const marketplace_validator_1 = require("./marketplace.validator");
const router = (0, express_1.Router)();
const auth = auth_middleware_1.authMiddleware;
const ownerAdmin = (0, role_middleware_1.roleMiddleware)("salon_owner", "admin");
// ── Full profile ──────────────────────────────────────────────────────────────
router.get("/profile", auth, ownerAdmin, marketplace_controller_1.marketplaceController.getProfile);
// ── Essentials & About ────────────────────────────────────────────────────────
router.put("/essentials", auth, ownerAdmin, marketplace_validator_1.validateUpsertEssentials, marketplace_controller_1.marketplaceController.upsertEssentials);
router.put("/about", auth, ownerAdmin, marketplace_validator_1.validateUpsertAbout, marketplace_controller_1.marketplaceController.upsertAbout);
// ── Location ──────────────────────────────────────────────────────────────────
router.get("/location", auth, ownerAdmin, marketplace_controller_1.marketplaceController.getLocation);
router.put("/location", auth, ownerAdmin, marketplace_validator_1.validateUpsertLocation, marketplace_controller_1.marketplaceController.upsertLocation);
// ── Opening Hours ─────────────────────────────────────────────────────────────
router.get("/working-hours", auth, ownerAdmin, marketplace_controller_1.marketplaceController.getWorkingHours);
router.put("/working-hours", auth, ownerAdmin, marketplace_validator_1.validateUpsertWorkingHours, marketplace_controller_1.marketplaceController.upsertWorkingHours);
// ── Venue Images ──────────────────────────────────────────────────────────────
router.get("/images", auth, ownerAdmin, marketplace_controller_1.marketplaceController.getImages);
router.post("/images", auth, ownerAdmin, marketplace_validator_1.validateAddImage, marketplace_controller_1.marketplaceController.addImage);
router.patch("/images/reorder", auth, ownerAdmin, marketplace_validator_1.validateReorderImages, marketplace_controller_1.marketplaceController.reorderImages);
router.patch("/images/:imageId/cover", auth, ownerAdmin, marketplace_controller_1.marketplaceController.setCoverImage);
router.delete("/images/:imageId", auth, ownerAdmin, marketplace_controller_1.marketplaceController.deleteImage);
// ── Amenities & Highlights ────────────────────────────────────────────────────
router.get("/features", auth, ownerAdmin, marketplace_controller_1.marketplaceController.getFeatures);
router.put("/features", auth, ownerAdmin, marketplace_validator_1.validateUpsertFeatures, marketplace_controller_1.marketplaceController.upsertFeatures);
// ── Publish / Unpublish ───────────────────────────────────────────────────────
router.post("/publish", auth, ownerAdmin, marketplace_controller_1.marketplaceController.publish);
router.post("/unpublish", auth, ownerAdmin, marketplace_controller_1.marketplaceController.unpublish);
exports.default = router;
//# sourceMappingURL=marketplace.routes.js.map