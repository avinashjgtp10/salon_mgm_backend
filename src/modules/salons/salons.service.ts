import { subscriptionCheckoutService } from "../subscriptions/subscription-checkout.service";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "./salons.repository";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";
import { authRepository } from "../auth/auth.repository";
import { issueSessionTokens } from "../auth/session.util";

const slugify = (text: string) =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

// Ensures a slug is unique by appending -2, -3, ... on collision.
export async function ensureUniqueSlug(base: string): Promise<string> {
    const slug = slugify(base);
    let finalSlug = slug;
    let i = 1;
    while (true) {
        const found = await salonsRepository.findBySlug(finalSlug);
        if (!found) break;
        i += 1;
        finalSlug = `${slug}-${i}`;
    }
    return finalSlug;
}

// A business can list up to this many numbers in total: the primary salons.phone plus the additional ones.
const MAX_BUSINESS_NUMBERS = 5;

// Cleans the extra business numbers: digits only, 7-15 digits, no blanks, no repeats and none equal to the
// primary number. Anything wrong is rejected with a message naming the number, never silently dropped.
function normalizeAdditionalPhones(input: unknown, primary: string | null | undefined): string[] {
    const primaryDigits = String(primary ?? "").replace(/\D/g, "");
    const seen = new Set<string>(primaryDigits ? [primaryDigits] : []);
    const out: string[] = [];
    for (const raw of Array.isArray(input) ? input : []) {
        const digits = String(raw ?? "").replace(/\D/g, "");
        if (!digits) continue;   // a blank row is just removed
        if (digits.length < 7 || digits.length > 15) {
            throw new AppError(400, `"${raw}" is not a valid phone number`, "VALIDATION_ERROR");
        }
        if (seen.has(digits)) {
            throw new AppError(400, `${digits === primaryDigits ? "The main business number can't be added again" : `"${raw}" is entered more than once`}`, "VALIDATION_ERROR");
        }
        seen.add(digits);
        out.push(digits);
    }
    if (out.length + 1 > MAX_BUSINESS_NUMBERS) {
        throw new AppError(400, `You can add up to ${MAX_BUSINESS_NUMBERS - 1} additional business numbers`, "VALIDATION_ERROR");
    }
    return out;
}

export const salonsService = {
    async create(ownerId: string, body: CreateSalonBody) {
        logger.info("salonsService.create called", { ownerId });

        const existing = await salonsRepository.findByOwnerId(ownerId);
        if (existing) {
            throw new AppError(409, "Salon already exists for this owner", "SALON_EXISTS");
        }

        const finalSlug = await ensureUniqueSlug(body.slug?.trim() || body.business_name);

        // The business address lives on the salon only. Registration collected an address/country
        // on the user row before any salon existed — carry those over so the salon starts with them
        // (anything sent in the onboarding body wins).
        const registrant = await authRepository.findUserById(ownerId);

        try {
            const salon = await salonsRepository.create(ownerId, {
                ...body,
                slug: finalSlug,
                address: body.address || registrant?.address || undefined,
                country: body.country || registrant?.country || undefined,
            });

            // Anything the owner subscribed to on the plan page before this salon existed now belongs to it.
            await subscriptionCheckoutService.attachPendingToSalon(ownerId, salon.id).catch((err) =>
                logger.error("attachPendingToSalon failed", { ownerId, salonId: salon.id, error: err?.message })
            );

            // Fetch user so we can embed the correct role in the new token
            const user = await authRepository.findUserById(ownerId);
            if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");

            // Promote to salon_owner if they came in as a client (e.g. Google OAuth)
            if (user.role !== "salon_owner") {
                await authRepository.upgradeToSalonOwner(ownerId);
                user.role = "salon_owner";
                logger.info("salonsService.create — user promoted to salon_owner", { ownerId });
            }

            // Re-issue tokens now that salonId exists and role is correct
            // kickOthers: false — this is the same person finishing onboarding
            // in their already-signed-in session, not a fresh login.
            const { accessToken, refreshToken } = await issueSessionTokens({
                userId: ownerId, role: user.role, salonId: salon.id, kickOthers: false,
            });

            // Mark onboarding complete
            await authRepository.markOnboardingComplete(ownerId);

            logger.info("salonsService.create success", {
                ownerId,
                salonId: salon.id,
                slug: salon.slug,
            });

            return {
                salon,
                accessToken,
                refreshToken,
                isOnboardingComplete: true,
            };
        } catch (e: any) {
            if (e?.code === "23505") {
                throw new AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },

    async mySalon(ownerId: string, salonId?: string | null): Promise<Salon> {
        // Salon owners: look up by owner_id
        const salon = await salonsRepository.findByOwnerId(ownerId);
        if (salon) return salonsService.ensureSlug(salon);

        // Staff users: they don't own a salon but their JWT carries salonId
        if (salonId) {
            const bySalonId = await salonsRepository.findById(salonId);
            if (bySalonId) return salonsService.ensureSlug(bySalonId);
        }

        throw new AppError(404, "Salon not found", "NOT_FOUND");
    },

    // Auto-generates and persists a slug for salons created before slugs existed.
    async ensureSlug(salon: Salon): Promise<Salon> {
        if (salon.slug) return salon;
        const slug = await ensureUniqueSlug(salon.business_name);
        try {
            return await salonsRepository.update(salon.id, { slug });
        } catch (e: any) {
            if (e?.code === "23505") {
                // Lost a race with a concurrent request — re-fetch the now-set slug.
                const refreshed = await salonsRepository.findById(salon.id);
                if (refreshed) return refreshed;
            }
            throw e;
        }
    },

    async getById(id: string): Promise<Salon> {
        const salon = await salonsRepository.findById(id);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        return salon;
    },

    async listAll(): Promise<Salon[]> {
        return salonsRepository.listAll();
    },

    async updateByOwnerOrAdmin(params: {
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateSalonBody;
    }): Promise<Salon> {
        const { salonId, requesterUserId, requesterRole, patch } = params;

        logger.info("salonsService.updateByOwnerOrAdmin called", {
            salonId,
            requesterUserId,
            requesterRole,
        });

        const salon = await salonsRepository.findById(salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const isAdmin = requesterRole === "admin";
        const isOwner = salon.owner_id === requesterUserId;

        if (!isAdmin && !isOwner) {
            throw new AppError(403, "Forbidden", "FORBIDDEN");
        }

        if (patch.slug) patch.slug = slugify(patch.slug);

        if (patch.additional_phones !== undefined) {
            patch.additional_phones = normalizeAdditionalPhones(patch.additional_phones, patch.phone ?? salon.phone);
        }

        try {
            const updated = await salonsRepository.update(salonId, patch);

            if (patch.onboarding_completed === true) {
                await authRepository.markOnboardingComplete(requesterUserId);
            }

            logger.info("salonsService.updateByOwnerOrAdmin success", {
                salonId: updated.id,
                slug: updated.slug,
            });

            return updated;
        } catch (e: any) {
            if (e?.code === "23505") {
                throw new AppError(409, "Slug already exists", "SLUG_EXISTS");
            }
            throw e;
        }
    },
};
