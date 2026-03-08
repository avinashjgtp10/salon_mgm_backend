import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import {
  marketplaceProfileRepo, marketplaceLocationRepo,
  marketplaceWorkingHoursRepo, marketplaceImagesRepo, marketplaceFeaturesRepo,
} from "./marketplace.repository";
import {
  Amenity, Highlight, Value,
  MarketplaceProfile, MarketplaceProfileFull, WorkingHoursDay,
  UpsertEssentialsBody, UpsertAboutBody, UpsertLocationBody,
  UpsertWorkingHoursBody, AddImageBody, ReorderImagesBody, UpsertFeaturesBody,
} from "./marketplace.types";

const MAX_IMAGES = 10;

// ─── Helper: ensure profile exists ───────────────────────────────────────────

async function _ensureProfile(salonId: string): Promise<MarketplaceProfile> {
  const profile = await marketplaceProfileRepo.findBySalonId(salonId);
  if (!profile) throw new AppError(404, "Marketplace profile not found. Save venue essentials first.", "NOT_FOUND");
  return profile;
}

// ─── Helper: group flat working hour rows into day objects ────────────────────

function _groupHours(rows: any[]): WorkingHoursDay[] {
  const map = new Map<number, WorkingHoursDay>();
  for (const r of rows) {
    if (!map.has(r.day_of_week)) {
      map.set(r.day_of_week, { day_of_week: r.day_of_week, is_open: r.is_open, slots: [] });
    }
    const day = map.get(r.day_of_week)!;
    if (r.is_open && r.open_time && r.close_time) {
      day.slots.push({ open_time: r.open_time, close_time: r.close_time });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.day_of_week - b.day_of_week);
}

// ─── Full Profile ─────────────────────────────────────────────────────────────

export const marketplaceService = {

  async getProfile(salonId: string): Promise<MarketplaceProfileFull> {
    const profile = await _ensureProfile(salonId);
    const [location, hourRows, images, featureRows] = await Promise.all([
      marketplaceLocationRepo.findByProfileId(profile.id),
      marketplaceWorkingHoursRepo.findByProfileId(profile.id),
      marketplaceImagesRepo.findByProfileId(profile.id),
      marketplaceFeaturesRepo.findByProfileId(profile.id),
    ]);

    return {
      ...profile,
      location,
      working_hours: _groupHours(hourRows),
      images,
      amenities:  featureRows.filter((f) => f.feature_type === "amenity")  .map((f) => f.feature_key as Amenity),
      highlights: featureRows.filter((f) => f.feature_type === "highlight").map((f) => f.feature_key as Highlight),
      values:     featureRows.filter((f) => f.feature_type === "value")    .map((f) => f.feature_key as Value),
    };
  },

  // ── Essentials ──────────────────────────────────────────────────────────────

  async upsertEssentials(salonId: string, data: UpsertEssentialsBody) {
    logger.info("marketplace.upsertEssentials", { salonId });
    return marketplaceProfileRepo.upsertEssentials(salonId, data);
  },

  // ── About ───────────────────────────────────────────────────────────────────

  async upsertAbout(salonId: string, data: UpsertAboutBody) {
    logger.info("marketplace.upsertAbout", { salonId });
    await _ensureProfile(salonId);
    return marketplaceProfileRepo.upsertAbout(salonId, data);
  },

  // ── Location ────────────────────────────────────────────────────────────────

  async getLocation(salonId: string) {
    const profile = await _ensureProfile(salonId);
    return marketplaceLocationRepo.findByProfileId(profile.id);
  },

  async upsertLocation(salonId: string, data: UpsertLocationBody) {
    logger.info("marketplace.upsertLocation", { salonId });
    const profile = await _ensureProfile(salonId);
    return marketplaceLocationRepo.upsert(profile.id, data);
  },

  // ── Working Hours ───────────────────────────────────────────────────────────

  async getWorkingHours(salonId: string) {
    const profile = await _ensureProfile(salonId);
    const rows = await marketplaceWorkingHoursRepo.findByProfileId(profile.id);
    return _groupHours(rows);
  },

  async upsertWorkingHours(salonId: string, data: UpsertWorkingHoursBody) {
    logger.info("marketplace.upsertWorkingHours", { salonId });
    const profile = await _ensureProfile(salonId);
    const rows = await marketplaceWorkingHoursRepo.upsertBulk(profile.id, data);
    return _groupHours(rows);
  },

  // ── Images ──────────────────────────────────────────────────────────────────

  async getImages(salonId: string) {
    const profile = await _ensureProfile(salonId);
    return marketplaceImagesRepo.findByProfileId(profile.id);
  },

  async addImage(salonId: string, data: AddImageBody) {
    logger.info("marketplace.addImage", { salonId });
    const profile = await _ensureProfile(salonId);

    const count = await marketplaceImagesRepo.count(profile.id);
    if (count >= MAX_IMAGES)
      throw new AppError(400, `Maximum of ${MAX_IMAGES} images allowed`, "LIMIT_EXCEEDED");

    return marketplaceImagesRepo.add(profile.id, data);
  },

  async setCoverImage(salonId: string, imageId: string) {
    logger.info("marketplace.setCoverImage", { salonId, imageId });
    const profile = await _ensureProfile(salonId);
    const updated = await marketplaceImagesRepo.setCover(imageId, profile.id);
    if (!updated) throw new AppError(404, "Image not found", "NOT_FOUND");
    return updated;
  },

  async reorderImages(salonId: string, data: ReorderImagesBody) {
    logger.info("marketplace.reorderImages", { salonId });
    const profile = await _ensureProfile(salonId);
    await marketplaceImagesRepo.reorder(profile.id, data);
    return marketplaceImagesRepo.findByProfileId(profile.id);
  },

  async deleteImage(salonId: string, imageId: string) {
    logger.info("marketplace.deleteImage", { salonId, imageId });
    const profile = await _ensureProfile(salonId);
    const deleted = await marketplaceImagesRepo.delete(imageId, profile.id);
    if (!deleted) throw new AppError(404, "Image not found", "NOT_FOUND");
  },

  // ── Features ────────────────────────────────────────────────────────────────

  async getFeatures(salonId: string) {
    const profile = await _ensureProfile(salonId);
    const rows = await marketplaceFeaturesRepo.findByProfileId(profile.id);
    return {
      amenities:  rows.filter((f) => f.feature_type === "amenity")  .map((f) => f.feature_key as Amenity),
      highlights: rows.filter((f) => f.feature_type === "highlight").map((f) => f.feature_key as Highlight),
      values:     rows.filter((f) => f.feature_type === "value")    .map((f) => f.feature_key as Value),
    };
  },

  async upsertFeatures(salonId: string, data: UpsertFeaturesBody) {
    logger.info("marketplace.upsertFeatures", { salonId });
    const profile = await _ensureProfile(salonId);
    await marketplaceFeaturesRepo.upsert(profile.id, data);
    return this.getFeatures(salonId);
  },

  // ── Publish ─────────────────────────────────────────────────────────────────

  async publish(salonId: string) {
    logger.info("marketplace.publish", { salonId });
    await _ensureProfile(salonId);
    const updated = await marketplaceProfileRepo.setPublished(salonId, true);
    if (!updated) throw new AppError(500, "Failed to publish", "INTERNAL_ERROR");
    return updated;
  },

  async unpublish(salonId: string) {
    logger.info("marketplace.unpublish", { salonId });
    await _ensureProfile(salonId);
    const updated = await marketplaceProfileRepo.setPublished(salonId, false);
    if (!updated) throw new AppError(500, "Failed to unpublish", "INTERNAL_ERROR");
    return updated;
  },
};