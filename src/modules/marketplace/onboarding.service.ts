import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { isModuleLocked } from "../../middleware/moduleLock.middleware";
import { bookingsRepository } from "../bookings/bookings.repository";
import { bookingsService } from "../bookings/bookings.service";
import { marketplaceProfileRepo, marketplaceLocationRepo, marketplaceWorkingHoursRepo } from "./marketplace.repository";
import { groupWorkingHours } from "./marketplace.service";
import { onboardingRepository, isMissingMigration, type OnboardingRow } from "./onboarding.repository";
import {
    STEPS, applyServiceSettings, businessProblems, displayStatus, locationProblems, normalizeLink, onboardingIssues, sameCoordinate,
    type BusinessInfo, type LocationInput, type PhotoCategory, type StoredStatus,
} from "./onboarding.rules";

const text = (value: unknown) => String(value ?? "").trim();

function failOn(problems: string[]) {
    if (problems.length) throw new AppError(400, problems.join(" "), "VALIDATION_ERROR");
}

/** A clear answer instead of a 500 while the SQL migration has not been run. */
async function withMigration<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (err) {
        if (!isMissingMigration(err)) throw err;
        throw new AppError(503, "Marketplace setup isn't available yet: the database update (add_marketplace_onboarding.sql) has not been applied.", "FEATURE_UNAVAILABLE");
    }
}

async function requireSalon(salonId: string) {
    const salon = await onboardingRepository.findSalon(salonId);
    if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
    return salon;
}

async function ensureProfile(salonId: string) {
    const existing = await marketplaceProfileRepo.findBySalonId(salonId);
    if (existing) return existing;
    const salon = await requireSalon(salonId);
    return marketplaceProfileRepo.upsertEssentials(salonId, { display_name: salon.business_name });
}

/** Reads the whole onboarding from the CRM's own records. Nothing is stored twice. */
async function buildState(salonId: string) {
    const salon = await requireSalon(salonId);
    const [row, profile] = await Promise.all([onboardingRepository.find(salonId), marketplaceProfileRepo.findBySalonId(salonId)]);

    const [savedLocation, photos, hourRows, services, staff, settings, staffServices, closedCount, policy] = await Promise.all([
        profile ? marketplaceLocationRepo.findByProfileId(profile.id) : Promise.resolve(null),
        profile ? onboardingRepository.listPhotos(profile.id) : Promise.resolve([]),
        profile ? marketplaceWorkingHoursRepo.findByProfileId(profile.id) : Promise.resolve([]),
        bookingsRepository.findActiveServices(salonId),
        bookingsRepository.findActiveStaff(salonId),
        onboardingRepository.serviceSettings(salonId),
        onboardingRepository.staffServiceIds(salonId),
        onboardingRepository.countServicesNotOpenOnline(salonId),
        bookingsRepository.findBookingPolicy(salonId),
    ]);
    const schedules = await onboardingRepository.weeklySchedules(staff.map((m) => m.id));
    const hidden = new Set(row?.hidden_staff_ids ?? []);
    const extra = profile as any;

    // Pre-filled from the CRM wherever the Marketplace profile has nothing of its own yet.
    const business: BusinessInfo = {
        name: text(salon.business_name),
        description: text(salon.description) || text(profile?.venue_description),
        phone: text(profile?.business_phone) || text(salon.phone),
        email: text(profile?.business_email) || text(salon.email),
        category: text(salon.business_category),
        business_type: text(salon.business_type),
        website: text(profile?.website) || text(salon.website_url),
        instagram: text(extra?.instagram_url),
    };

    const latitude = savedLocation?.latitude != null ? Number(savedLocation.latitude) : null;
    const longitude = savedLocation?.longitude != null ? Number(savedLocation.longitude) : null;
    const countryGuess = text(savedLocation?.country) || text(salon.country);
    const location = {
        address_line: text(savedLocation?.address_line) || text(salon.address),
        city: text(savedLocation?.city) || text(salon.city),
        state: text(savedLocation?.state) || text(salon.state),
        country: /^(uae|ae|united arab emirates)$/i.test(countryGuess) ? "United Arab Emirates" : /^(india|in)$/i.test(countryGuess) ? "India" : "",
        postal_code: text(savedLocation?.postal_code) || text(salon.pincode),
        latitude,
        longitude,
        place_id: row?.location_place_id ?? null,
        // Changed anywhere else since "Confirm Location" = not confirmed any more.
        confirmed: !!row?.location_confirmed_at && sameCoordinate(row.confirmed_latitude, latitude) && sameCoordinate(row.confirmed_longitude, longitude),
    };

    const serviceList = services.map((s) => {
        const setting = settings.get(String(s.id));
        return {
            id: s.id as string,
            name: s.name as string,
            category: s.category_name as string,
            duration: Number(s.duration) || 0,
            price: Number(s.price) || 0,
            display_price: setting?.display_price != null ? Number(setting.display_price) : null,
            is_listed: setting?.is_listed !== false,
        };
    });
    const staffList = staff.map((m) => ({
        id: m.id as string,
        name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Staff",
        designation: (m.designation ?? null) as string | null,
        avatar_url: (m.avatar_url ?? null) as string | null,
        shown: !hidden.has(m.id),
        service_ids: staffServices.get(m.id) ?? [],
        schedule: schedules.filter((s: any) => s.staff_id === m.id).map(({ staff_id: _omit, ...day }: any) => day),
    }));
    const hours = groupWorkingHours(hourRows);
    const preferences = {
        bookings_enabled: row?.bookings_enabled ?? true,
        cancellation_notice_hours: Number(policy.cancellation_notice_hours) || 0,
        min_notice_hours: Number(policy.min_notice_hours) || 0,
        max_advance_days: Number(policy.max_advance_days) || 30,
        allow_same_day_booking: policy.allow_same_day_booking !== false,
    };

    const issues = onboardingIssues({
        hasSlug: !!salon.slug,
        business,
        location,
        photos,
        services: serviceList,
        staff: staffList,
        hasOpenDay: hours.some((d) => d.is_open && d.slots.length > 0),
        saved: { services: !!row?.services_saved_at, availability: !!row?.availability_saved_at, preferences: !!row?.preferences_saved_at },
    });

    // "Active" means customers can really see it. Each reason it can't be seen is named for the owner.
    const blockers: string[] = [];
    if (row?.status === "approved") {
        if (!salon.is_active) blockers.push("Your salon account is inactive.");
        if (salon.is_dummy) blockers.push("This is marked as a demo salon, which is never listed publicly.");
        if (!profile?.is_published) blockers.push("Online Booking is switched off in your Marketplace settings.");
        if (await isModuleLocked(salonId, "online_booking")) blockers.push("Online Booking is not enabled for your salon.");
        if (!serviceList.some((s) => s.is_listed)) blockers.push("No service is published.");
    }

    return {
        status: displayStatus(row, issues.length > 0, blockers.length === 0),
        current_step: row?.current_step ?? 1,
        rejection_reason: row?.status === "rejected" ? row.rejection_reason : null,
        submitted_at: row?.submitted_at ?? null,
        reviewed_at: row?.reviewed_at ?? null,
        slug: salon.slug as string | null,
        currency: (salon.currency ?? null) as string | null,
        issues,
        live_blockers: blockers,
        business,
        location,
        photos,
        services: serviceList,
        services_not_open_online: closedCount,
        staff: staffList,
        hours,
        preferences,
    };
}

export type OnboardingState = Awaited<ReturnType<typeof buildState>>;

/** Remembers the furthest step the owner has saved, so they can resume there. */
async function remember(salonId: string, step: number, patch: Record<string, unknown> = {}) {
    await onboardingRepository.ensure(salonId);
    const row = (await onboardingRepository.find(salonId)) as OnboardingRow;
    await onboardingRepository.update(salonId, { ...patch, current_step: Math.min(STEPS.length, Math.max(row.current_step, step)) });
}

export const onboardingService = {
    getState: (salonId: string) =>
        withMigration(async () => {
            const state = await buildState(salonId);
            const activity = state.status === "approved" || state.status === "active"
                ? await onboardingRepository.bookingActivity(salonId)
                : null;
            return { ...state, activity };
        }),

    /** Where the owner is, without saving anything else. */
    setStep: (salonId: string, step: number) =>
        withMigration(async () => {
            await remember(salonId, step);
            return buildState(salonId);
        }),

    saveBusiness: (salonId: string, input: BusinessInfo) =>
        withMigration(async () => {
            failOn(businessProblems(input));
            await onboardingRepository.ensure(salonId); // fails first if the migration is missing, before any CRM write
            await onboardingRepository.saveBusiness(salonId, {
                name: input.name.trim(),
                description: input.description.trim(),
                category: input.category.trim() || null, // optional
                business_type: input.business_type.trim(),
                phone: input.phone.trim(),
                email: input.email.trim(),
                website: normalizeLink(input.website) || null,
                instagram: normalizeLink(input.instagram, true) || null,
            });
            await remember(salonId, 2);
            return buildState(salonId);
        }),

    /** "Confirm Location": saves the pin and records that the owner confirmed exactly these coordinates. */
    confirmLocation: (salonId: string, input: LocationInput & { place_id?: string | null }) =>
        withMigration(async () => {
            failOn(locationProblems(input));
            await onboardingRepository.ensure(salonId);
            const profile = await ensureProfile(salonId);
            const saved = await marketplaceLocationRepo.upsert(profile.id, {
                address_line: input.address_line.trim(),
                city: input.city.trim(),
                state: input.state.trim(),
                country: input.country,
                postal_code: input.postal_code.trim() || null,
                latitude: input.latitude,
                longitude: input.longitude,
            });
            await remember(salonId, 3, {
                location_place_id: input.place_id ? String(input.place_id).slice(0, 300) : null,
                location_confirmed_at: new Date(),
                confirmed_latitude: saved.latitude,
                confirmed_longitude: saved.longitude,
            });
            return buildState(salonId);
        }),

    setPhotoCategory: (salonId: string, imageId: string, category: PhotoCategory) =>
        withMigration(async () => {
            const profile = await ensureProfile(salonId);
            if (!(await onboardingRepository.setPhotoCategory(profile.id, imageId, category))) {
                throw new AppError(404, "Photo not found", "NOT_FOUND");
            }
            await remember(salonId, 3);
            return buildState(salonId);
        }),

    saveServices: (salonId: string, items: { service_id: string; is_listed: boolean; display_price: number | null }[]) =>
        withMigration(async () => {
            await onboardingRepository.ensure(salonId);
            await onboardingRepository.saveServiceSettings(salonId, items);
            await remember(salonId, 5, { services_saved_at: new Date() });
            return buildState(salonId);
        }),

    saveAvailability: (salonId: string, hiddenStaffIds: string[]) =>
        withMigration(async () => {
            await remember(salonId, 6, { hidden_staff_ids: hiddenStaffIds, availability_saved_at: new Date() });
            return buildState(salonId);
        }),

    assignStaffServices: (salonId: string, staffId: string, serviceIds: string[]) =>
        withMigration(async () => {
            if (!(await bookingsRepository.findStaffById(staffId, salonId))) {
                throw new AppError(404, "Staff member not found", "NOT_FOUND");
            }
            await onboardingRepository.replaceStaffServices(salonId, staffId, serviceIds);
            return buildState(salonId);
        }),

    savePreferences: (salonId: string, p: OnboardingState["preferences"]) =>
        withMigration(async () => {
            await onboardingRepository.ensure(salonId);
            await ensureProfile(salonId);
            // The same booking rules Online Booking already enforces: one setting, not a second copy.
            await marketplaceProfileRepo.upsertBookingPolicy(salonId, {
                cancellation_notice_hours: p.cancellation_notice_hours,
                min_notice_hours: p.min_notice_hours,
                max_advance_days: p.max_advance_days,
                allow_same_day_booking: p.allow_same_day_booking,
            });
            await remember(salonId, 7, { bookings_enabled: p.bookings_enabled, preferences_saved_at: new Date() });
            return buildState(salonId);
        }),

    submit: (salonId: string, userId: string, termsAccepted: boolean) =>
        withMigration(async () => {
            if (!termsAccepted) throw new AppError(400, "Please agree to the Marketplace Terms.", "VALIDATION_ERROR");
            const state = await buildState(salonId);
            if (state.issues.length) {
                throw new AppError(400, `Setup is not complete. ${state.issues[0].message}`, "SETUP_INCOMPLETE", { issues: state.issues });
            }
            await onboardingRepository.ensure(salonId);
            const moved = await onboardingRepository.transition(salonId, ["draft", "rejected"], {
                status: "submitted", submitted_at: new Date(), terms_accepted_at: new Date(), terms_accepted_by: userId,
                rejection_reason: null, reviewed_at: null, reviewed_by: null, current_step: STEPS.length,
            });
            if (!moved) throw new AppError(409, "This salon has already been submitted.", "ALREADY_SUBMITTED");
            logger.info("marketplace.onboarding.submitted", { salonId, userId });
            return buildState(salonId);
        }),

    /** The profile as customers would see it, for the owner (or reviewer) before it is public. */
    preview: (salonId: string) =>
        withMigration(async () => {
            const salon = await bookingsRepository.findSalonForPreview(salonId);
            if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
            const [row, settings, parts] = await Promise.all([
                onboardingRepository.find(salonId),
                onboardingRepository.serviceSettings(salonId),
                bookingsService.buildMarketplacePreview(salon),
            ]);
            const hidden = new Set(row?.hidden_staff_ids ?? []);
            return {
                page: {
                    salon: { ...parts.page.salon, marketplace_bookings_enabled: row?.bookings_enabled ?? true },
                    services: applyServiceSettings(parts.page.services as any[], settings),
                    staff: parts.page.staff.filter((m: any) => !hidden.has(m.id)),
                },
                extras: parts.extras,
            };
        }),

    // ── Super Admin review ───────────────────────────────────────────────────

    listForReview: (status: StoredStatus) => withMigration(() => onboardingRepository.listForReview(status)),

    approve: (salonId: string, reviewerId: string) =>
        withMigration(async () => {
            // Checked again now: the CRM records may have changed since the salon pressed Submit.
            const state = await buildState(salonId);
            if (state.issues.length) {
                throw new AppError(409, `This salon no longer meets the requirements. ${state.issues[0].message}`, "SETUP_INCOMPLETE", { issues: state.issues });
            }
            const moved = await onboardingRepository.transition(salonId, ["submitted"], {
                status: "approved", reviewed_at: new Date(), reviewed_by: reviewerId, rejection_reason: null,
            });
            if (!moved) throw new AppError(409, "Only a submitted salon can be approved.", "INVALID_STATUS");
            // Approval publishes the profile, which also opens the salon's booking page.
            await marketplaceProfileRepo.setPublished(salonId, true);
            logger.info("marketplace.onboarding.approved", { salonId, reviewerId });
            return buildState(salonId);
        }),

    /** Rejects a submission, or takes an approved salon off the Marketplace. Its booking link is not touched. */
    reject: (salonId: string, reviewerId: string, reason: string) =>
        withMigration(async () => {
            const clean = reason.trim();
            if (clean.length < 5 || clean.length > 1000) throw new AppError(400, "Give a reason of 5 to 1,000 characters.", "VALIDATION_ERROR");
            const moved = await onboardingRepository.transition(salonId, ["submitted", "approved"], {
                status: "rejected", reviewed_at: new Date(), reviewed_by: reviewerId, rejection_reason: clean,
            });
            if (!moved) throw new AppError(409, "Only a submitted or approved salon can be rejected.", "INVALID_STATUS");
            logger.info("marketplace.onboarding.rejected", { salonId, reviewerId });
            return buildState(salonId);
        }),
};
