import { subscriptionCheckoutService } from "../subscriptions/subscription-checkout.service";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "./salons.repository";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";
import { authRepository } from "../auth/auth.repository";
import { issueSessionTokens } from "../auth/session.util";
import { regionalDefaultsForCountry, normalizeCountryCode } from "../../config/salonTimezone";
import { seedUaeVatDefaults } from "../settings/tax.util";
import { emailService } from "../utils/email.service";

// The mandatory onboarding answers the backend keeps: the business name (entered at sign-up, confirmed on the first step) and the
// service category chosen on the second. (The team size and location choices are not stored on the salon.)
const hasMandatoryOnboardingData = (salon: Salon) =>
    Boolean(salon.business_name?.trim()) && Boolean(salon.business_type?.trim());

const fmtValidUntil = (v: unknown) =>
    v ? new Date(v as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null;

// Marks the owner's onboarding complete (stamping users.onboarding_completed_at) and sends the "onboarding complete" welcome email —
// but only when this call is the one that actually completed it (the flip is one atomic update, so a repeated call to the
// completion API, a retry or a double click can never send a second email), only to the salon's owner, and only once the
// mandatory onboarding data is in. Registering or buying a plan never gets here. Best effort: a mail problem never fails onboarding.
export async function completeOnboarding(userId: string, salon: Salon): Promise<void> {
    const firstTime = await authRepository.markOnboardingComplete(userId);
    if (!firstTime) return;
    if (salon.owner_id !== userId || !hasMandatoryOnboardingData(salon)) {
        logger.info("Onboarding marked complete; welcome email skipped (not the owner, or mandatory onboarding data missing)", { userId, salonId: salon.id });
        return;
    }
    void (async () => {
        try {
            const user: any = await authRepository.findUserById(userId);
            if (!user?.email) return;
            const plan = await salonsRepository.currentPlanSummary(salon.id).catch(() => null);
            await emailService.sendOnboardingCompleteEmail({
                to: user.email,
                ownerName: user.first_name,
                salonName: salon.business_name,
                planName: plan?.plan_name ?? (plan?.is_trial ? "Free Trial" : null),
                validUntil: fmtValidUntil(plan?.valid_until),
            });
            logger.info("Onboarding-complete email sent", { userId, salonId: salon.id });
        } catch (err: any) {
            logger.error("Onboarding-complete email failed", { userId, error: err?.message });
        }
    })();
}

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

// A salon signing up from a country we support (e.g. UAE) starts with that country's
// timezone and currency instead of the India defaults — unless the body already chose its own.
// India (and any unlisted country) is left exactly as before.
async function applyRegionalDefaults(salon: Salon, body: { timezone?: unknown; currency?: unknown }) {
    const regional = regionalDefaultsForCountry(salon.country);
    if (regional && !body.timezone && !body.currency) {
        await salonsRepository.update(salon.id, regional).catch((err) =>
            logger.error("regional defaults failed", { salonId: salon.id, error: err?.message })
        );
    }
    // UAE salons also start with a 5% VAT mapping (module off until they confirm VAT registration).
    if (normalizeCountryCode(salon.country) === "AE") {
        await seedUaeVatDefaults(salon.id).catch((err) =>
            logger.error("UAE VAT defaults failed", { salonId: salon.id, error: err?.message })
        );
    }
}

export const salonsService = {
    // The owner's salon, created from their registration details if it doesn't exist yet. Used when a payment arrives before
    // onboarding, so the subscription and its invoice have a salon to belong to; onboarding later fills the same salon in
    // (create() above). Safe to call repeatedly or concurrently: it never makes a second salon.
    async ensureForOwner(ownerId: string): Promise<Salon | null> {
        const existing = await salonsRepository.findByOwnerId(ownerId);
        if (existing) return existing;
        const registrant: any = await authRepository.findUserById(ownerId);
        if (!registrant) return null;
        const fullName = [registrant.first_name, registrant.last_name].filter(Boolean).join(" ").trim();
        const name = String(registrant.business_name ?? "").trim() || fullName || "My Salon";
        try {
            const salon = await salonsRepository.create(ownerId, {
                business_name: name,
                slug: await ensureUniqueSlug(name),
                email: registrant.email ?? undefined,
                phone: registrant.phone ?? undefined,
                address: registrant.address || undefined,
                country: registrant.country || undefined,
            } as CreateSalonBody);
            await applyRegionalDefaults(salon, {});
            logger.info("Salon created for owner at payment time", { ownerId, salonId: salon.id });
            return salon;
        } catch (e: any) {
            // A concurrent call made it first.
            const raced = await salonsRepository.findByOwnerId(ownerId);
            if (raced) return raced;
            throw e;
        }
    },

    async create(ownerId: string, body: CreateSalonBody) {
        logger.info("salonsService.create called", { ownerId });

        // A salon that already exists is fine while onboarding is unfinished: it was created when the owner's payment arrived
        // (see ensureForOwner), so onboarding fills it in. Once onboarding is complete a second create is still refused.
        const existing = await salonsRepository.findByOwnerId(ownerId);
        // The business address lives on the salon only. Registration collected an address/country
        // on the user row before any salon existed — carry those over so the salon starts with them
        // (anything sent in the onboarding body wins).
        const registrant = await authRepository.findUserById(ownerId);
        if (existing && (registrant as any)?.is_onboarding_complete) {
            throw new AppError(409, "Salon already exists for this owner", "SALON_EXISTS");
        }

        try {
            let salon: Salon;
            if (existing) {
                const wantsSlug = body.slug?.trim();
                salon = await salonsRepository.update(existing.id, {
                    ...body,
                    slug: wantsSlug && wantsSlug !== existing.slug ? await ensureUniqueSlug(wantsSlug) : existing.slug,
                    address: body.address || registrant?.address || undefined,
                    country: body.country || registrant?.country || undefined,
                } as UpdateSalonBody);
            } else {
                const finalSlug = await ensureUniqueSlug(body.slug?.trim() || body.business_name);
                salon = await salonsRepository.create(ownerId, {
                    ...body,
                    slug: finalSlug,
                    address: body.address || registrant?.address || undefined,
                    country: body.country || registrant?.country || undefined,
                });
                await applyRegionalDefaults(salon, body);
            }

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
            await completeOnboarding(ownerId, salon);

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
                await completeOnboarding(requesterUserId, updated);
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
