import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { onboardingService } from "./onboarding.service";
import { PHOTO_CATEGORIES, STEPS, type PhotoCategory, type StoredStatus } from "./onboarding.rules";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (message: string): never => { throw new AppError(400, message, "VALIDATION_ERROR"); };
const uuid = (value: unknown, name: string) => (typeof value === "string" && UUID_RE.test(value) ? value : bad(`${name} is not valid`));
const uuidList = (value: unknown, name: string, max = 1000): string[] =>
    Array.isArray(value) && value.length <= max ? value.map((v) => uuid(v, name)) : bad(`${name} must be a list`);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const wholeNumber = (value: unknown, name: string, min: number, max: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : bad(`${name} must be a whole number from ${min} to ${max}`);
};
const coordinate = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));

// The salon always comes from the signed-in user, never from the request, so one salon can't touch another's setup.
const salonOf = (req: AuthRequest): string => req.user?.salonId ?? ((): never => { throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT"); })();

const handle = (message: string, work: (req: AuthRequest) => Promise<unknown>) =>
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try { return sendSuccess(res, 200, await work(req), message); }
        catch (err) { return next(err); }
    };

export const onboardingController = {
    getState: handle("Marketplace setup fetched", (req) => onboardingService.getState(salonOf(req))),

    setStep: handle("Step saved", (req) => onboardingService.setStep(salonOf(req), wholeNumber(req.body?.step, "step", 1, STEPS.length))),

    saveBusiness: handle("Salon information saved", (req) => {
        const b = req.body ?? {};
        return onboardingService.saveBusiness(salonOf(req), {
            name: str(b.name), description: str(b.description), phone: str(b.phone), email: str(b.email),
            category: str(b.category).slice(0, 100), business_type: str(b.business_type).slice(0, 100),
            website: str(b.website).slice(0, 255), instagram: str(b.instagram).slice(0, 255),
        });
    }),

    confirmLocation: handle("Location confirmed", (req) => {
        const b = req.body ?? {};
        return onboardingService.confirmLocation(salonOf(req), {
            address_line: str(b.address_line).slice(0, 255), city: str(b.city).slice(0, 100), state: str(b.state).slice(0, 100),
            country: str(b.country), postal_code: str(b.postal_code).slice(0, 20),
            latitude: coordinate(b.latitude), longitude: coordinate(b.longitude), place_id: str(b.place_id) || null,
        });
    }),

    setPhotoCategory: handle("Photo type saved", (req) => {
        const category = str(req.body?.category) as PhotoCategory;
        if (!PHOTO_CATEGORIES.includes(category)) bad("Choose a photo type");
        return onboardingService.setPhotoCategory(salonOf(req), uuid(req.params.imageId, "Photo"), category);
    }),

    saveServices: handle("Services saved", (req) => {
        const items = req.body?.services;
        if (!Array.isArray(items) || items.length > 2000) bad("services must be a list");
        const seen = new Set<string>();
        return onboardingService.saveServices(salonOf(req), (items as any[]).map((item) => {
            const id = uuid(item?.service_id, "Service");
            if (seen.has(id)) bad("A service is repeated");
            seen.add(id);
            if (typeof item.is_listed !== "boolean") bad("is_listed must be true or false");
            let price: number | null = null;
            if (item.display_price !== null && item.display_price !== undefined && item.display_price !== "") {
                price = Number(item.display_price);
                if (!Number.isFinite(price) || price < 0 || price > 10_000_000) bad("Enter a valid Marketplace price");
                price = Math.round(price * 100) / 100;
            }
            return { service_id: id, is_listed: item.is_listed as boolean, display_price: price };
        }));
    }),

    saveAvailability: handle("Staff and availability saved", (req) =>
        onboardingService.saveAvailability(salonOf(req), uuidList(req.body?.hidden_staff_ids, "Staff"))),

    assignStaffServices: handle("Services assigned", (req) =>
        onboardingService.assignStaffServices(salonOf(req), uuid(req.params.staffId, "Staff"), uuidList(req.body?.service_ids, "Service"))),

    savePreferences: handle("Booking preferences saved", (req) => {
        const b = req.body ?? {};
        if (typeof b.bookings_enabled !== "boolean" || typeof b.allow_same_day_booking !== "boolean") bad("Preferences are incomplete");
        return onboardingService.savePreferences(salonOf(req), {
            bookings_enabled: b.bookings_enabled,
            allow_same_day_booking: b.allow_same_day_booking,
            cancellation_notice_hours: wholeNumber(b.cancellation_notice_hours, "Cancellation notice", 0, 720),
            min_notice_hours: wholeNumber(b.min_notice_hours, "Minimum notice", 0, 720),
            max_advance_days: wholeNumber(b.max_advance_days, "Advance booking days", 1, 365),
        });
    }),

    submit: handle("Submitted for review", (req) =>
        onboardingService.submit(salonOf(req), req.user!.userId, req.body?.terms_accepted === true)),

    preview: handle("Preview fetched", (req) => onboardingService.preview(salonOf(req))),
};

const REVIEW_STATUSES: StoredStatus[] = ["submitted", "approved", "rejected", "draft"];

export const marketplaceReviewController = {
    list: handle("Salons fetched", (req) => {
        const status = (str(req.query.status) || "submitted") as StoredStatus;
        if (!REVIEW_STATUSES.includes(status)) bad("Unknown status");
        return onboardingService.listForReview(status);
    }),
    detail: handle("Salon fetched", (req) => onboardingService.getState(uuid(req.params.salonId, "Salon"))),
    preview: handle("Preview fetched", (req) => onboardingService.preview(uuid(req.params.salonId, "Salon"))),
    approve: handle("Salon approved", (req) => onboardingService.approve(uuid(req.params.salonId, "Salon"), req.user!.userId)),
    reject: handle("Salon rejected", (req) => onboardingService.reject(uuid(req.params.salonId, "Salon"), req.user!.userId, str(req.body?.reason))),
};
