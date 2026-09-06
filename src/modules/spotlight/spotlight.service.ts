import { AppError } from "../../middleware/error.middleware";
import logger from "../../config/logger";
import { spotlightRepository } from "./spotlight.repository";
import { salonsRepository } from "../salons/salons.repository";
import { notificationsService } from "../notifications/notifications.service";
import { SpotlightCreateBody, SpotlightFeature, SpotlightUpdateBody } from "./spotlight.types";

async function getOwned(id: string): Promise<SpotlightFeature> {
    const feature = await spotlightRepository.findById(id);
    if (!feature) throw new AppError(404, "Spotlight feature not found", "NOT_FOUND");
    return feature;
}

// Same set of URL shapes the frontend's youtube.ts accepts (watch/youtu.be/
// embed/shorts) — kept in sync deliberately rather than shared, since this
// is the only cross-cutting validation rule between the two codebases here.
// Server-side check exists so a non-YouTube (or malformed) value can never
// reach the DB via a direct API call that bypasses the form's own check.
const YOUTUBE_URL_RE =
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/;

function assertValidVideoUrl(videoDataUrl: string | null | undefined): void {
    if (!videoDataUrl?.trim()) return;
    if (!YOUTUBE_URL_RE.test(videoDataUrl.trim())) {
        throw new AppError(400, "videoDataUrl must be a valid YouTube URL", "VALIDATION_ERROR");
    }
}

// Fires one notification per active salon, fire-and-forget per salon (a
// single salon's push/email failure must never block the rest, or make the
// publish API call itself slow/fail) — mirrors the fire-and-forget
// convention every other notificationsService.create() call site in this
// codebase already uses (see clients.service.ts, appointments.service.ts).
// Not awaited by publish() itself, so the superadmin's publish click
// returns immediately regardless of how many salons exist.
async function broadcastPublishNotification(feature: SpotlightFeature): Promise<void> {
    let salonIds: string[] = [];
    try {
        salonIds = await salonsRepository.listAllActiveIds();
    } catch (err: any) {
        logger.error("[SPOTLIGHT] failed to list salons for publish broadcast", { message: err?.message });
        return;
    }

    logger.info("[SPOTLIGHT] broadcasting publish notification", { featureId: feature.id, salonCount: salonIds.length });

    for (const salonId of salonIds) {
        notificationsService.create({
            salon_id: salonId,
            type: "spotlight",
            title: "New Feature Added",
            body: `${feature.featureName} — ${feature.shortDescription}`,
            event_key: "spotlightFeature",
            spotlight_feature_id: feature.id,
        }).catch((err: any) =>
            logger.warn("[SPOTLIGHT] notification failed for salon", { salonId, featureId: feature.id, message: err?.message })
        );
    }
}

export const spotlightService = {
    // Superadmin-only reads include draft/archived; salon-facing reads never
    // do (see spotlight.controller.ts's route-level split, not just this
    // flag, so a bug here can't leak drafts to salon users).
    async list(includeUnpublished: boolean): Promise<SpotlightFeature[]> {
        return spotlightRepository.list(includeUnpublished);
    },

    async getById(id: string): Promise<SpotlightFeature> {
        return getOwned(id);
    },

    async create(body: SpotlightCreateBody, createdBy: string): Promise<SpotlightFeature> {
        if (!body.featureName?.trim()) throw new AppError(400, "featureName is required", "VALIDATION_ERROR");
        if (!body.module?.trim()) throw new AppError(400, "module is required", "VALIDATION_ERROR");
        if (!body.shortDescription?.trim()) throw new AppError(400, "shortDescription is required", "VALIDATION_ERROR");
        assertValidVideoUrl(body.videoDataUrl);

        const created = await spotlightRepository.create(body, createdBy);

        // Creating directly with status: "published" (vs. the separate
        // publish() action below) still needs the broadcast — same rule
        // either way: notify exactly once, only on this row's first-ever
        // transition into 'published'.
        if (created.status === "published") {
            broadcastPublishNotification(created).catch(() => { /* logged internally */ });
        }
        return created;
    },

    async update(id: string, body: SpotlightUpdateBody): Promise<SpotlightFeature> {
        await getOwned(id);
        assertValidVideoUrl(body.videoDataUrl);

        // A caller setting status: "published" through the generic update
        // endpoint (rather than the dedicated publish() action) must still
        // only broadcast once, on a genuine first publish — route it through
        // the same markPublished() gate so both paths share one rule.
        if (body.status === "published") {
            return spotlightService.publish(id);
        }

        const updated = await spotlightRepository.update(id, body);
        if (!updated) throw new AppError(404, "Spotlight feature not found", "NOT_FOUND");
        return updated;
    },

    // Dedicated publish action — idempotent: calling it again on an
    // already-published feature just returns the current row without a
    // second broadcast (markPublished() returns null in that case, which is
    // the signal not to notify).
    async publish(id: string): Promise<SpotlightFeature> {
        const firstTimePublish = await spotlightRepository.markPublished(id);
        const feature = firstTimePublish ?? await getOwned(id);

        if (firstTimePublish) {
            broadcastPublishNotification(firstTimePublish).catch(() => { /* logged internally */ });
        }
        return feature;
    },

    async delete(id: string): Promise<void> {
        await getOwned(id);
        await spotlightRepository.delete(id);
    },

    // ── Salon-facing: per-user explored state ───────────────────────────────

    async getExploredIds(userId: string): Promise<string[]> {
        return spotlightRepository.getExploredIds(userId);
    },

    async markExplored(featureId: string, userId: string): Promise<void> {
        // No pre-check needed — the FK to spotlight_features throws a normal
        // 23503 for a bogus id, and a client only ever calls this with an id
        // it already has from list()/getById(), so that's an acceptable hard
        // failure rather than something to special-case here.
        await spotlightRepository.markExplored(featureId, userId);
    },
};
