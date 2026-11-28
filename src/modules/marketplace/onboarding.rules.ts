// SalonOx Marketplace onboarding: the rules, with no database or HTTP in them, so they can be tested directly.
// The server is the only judge of whether a step is complete; the wizard just shows what these return.

export const PHOTO_CATEGORIES = ["interior", "exterior", "portfolio", "team"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
/** The only compulsory photo rule. Any 3 photos count; their type and the cover are the salon's choice. */
export const MIN_SALON_PHOTOS = 3;
export const MIN_DESCRIPTION = 20;

export const STEPS = ["business", "location", "photos", "services", "availability", "preferences", "review"] as const;
export type StepKey = (typeof STEPS)[number];
export interface Issue { step: StepKey; message: string }

export type StoredStatus = "draft" | "submitted" | "approved" | "rejected";
export type DisplayStatus = "not_started" | "in_progress" | "setup_incomplete" | "submitted" | "approved" | "rejected" | "active";

export const COUNTRIES = ["India", "United Arab Emirates"] as const;
export type Country = (typeof COUNTRIES)[number];
// Rough outer boxes. They catch a pin dropped in the wrong country; they are not exact borders.
const BOUNDS: Record<Country, { lat: [number, number]; lng: [number, number] }> = {
    "India": { lat: [6.4, 37.2], lng: [68.0, 97.5] },
    "United Arab Emirates": { lat: [22.5, 26.4], lng: [51.4, 56.5] },
};

export interface BusinessInfo {
    name: string; description: string; phone: string; email: string; category: string; business_type: string;
    website: string; instagram: string;
}

export interface LocationInput {
    address_line: string; city: string; state: string; country: string; postal_code: string;
    latitude: number | null; longitude: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const isWebUrl = (value: string) => {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
    } catch { return false; }
};

/** "glowsalon.com" -> "https://glowsalon.com"; "@glow" or "glow" for Instagram -> the profile address. */
export function normalizeLink(raw: string, instagram = false): string {
    const value = raw.trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (instagram && !value.includes("instagram.com") && /^@?[A-Za-z0-9._]{1,30}$/.test(value)) {
        return `https://www.instagram.com/${value.replace(/^@/, "")}`;
    }
    return `https://${value}`;
}

export function businessProblems(b: BusinessInfo): string[] {
    const problems: string[] = [];
    const name = b.name.trim();
    if (name.length < 2 || name.length > 100) problems.push("Enter your salon name (2 to 100 characters).");
    if (b.description.trim().length < MIN_DESCRIPTION) problems.push(`Describe your business in at least ${MIN_DESCRIPTION} characters.`);
    if (b.description.trim().length > 2000) problems.push("Keep the description under 2,000 characters.");
    const digits = b.phone.replace(/\D/g, "");
    if (!/^[+\d\s()-]+$/.test(b.phone.trim()) || digits.length < 7 || digits.length > 15) problems.push("Enter a valid contact number.");
    if (!EMAIL_RE.test(b.email.trim())) problems.push("Enter a valid email address.");
    if (!b.business_type.trim()) problems.push("Choose a business type.");
    if (b.website.trim() && !isWebUrl(normalizeLink(b.website))) problems.push("Enter a valid website address, or leave it empty.");
    if (b.instagram.trim()) {
        const link = normalizeLink(b.instagram, true);
        if (!isWebUrl(link) || !/(^|\.)instagram\.com$/i.test(new URL(link).hostname)) problems.push("Enter an Instagram page or username, or leave it empty.");
    }
    return problems;
}

export function locationProblems(l: LocationInput): string[] {
    const problems: string[] = [];
    if (!l.address_line.trim()) problems.push("Enter the street address.");
    if (!l.city.trim()) problems.push("Enter the city.");
    if (!l.state.trim()) problems.push("Enter the state or emirate.");
    const country = COUNTRIES.find((c) => c === l.country);
    if (!country) problems.push("Choose India or United Arab Emirates.");
    // The UAE has no postal codes.
    if (country === "India" && !/^\d{6}$/.test(l.postal_code.trim())) problems.push("Enter the 6-digit PIN code.");
    const { latitude: lat, longitude: lng } = l;
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        problems.push("Select your location on the map.");
    } else if (country) {
        const box = BOUNDS[country];
        if (lat < box.lat[0] || lat > box.lat[1] || lng < box.lng[0] || lng > box.lng[1]) problems.push(`The map pin is not inside ${country}.`);
    }
    return problems;
}

export const sameCoordinate = (a: unknown, b: unknown) =>
    a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) < 0.000001;

export function photoProblems(photos: unknown[]): string[] {
    return photos.length < MIN_SALON_PHOTOS ? [`Add at least ${MIN_SALON_PHOTOS} salon photos.`] : [];
}

export interface Snapshot {
    hasSlug: boolean;
    business: BusinessInfo;
    location: LocationInput & { confirmed: boolean };
    photos: { category: string | null; is_cover: boolean }[];
    services: { is_listed: boolean }[];
    staff: { shown: boolean }[];
    hasOpenDay: boolean;
    saved: { services: boolean; availability: boolean; preferences: boolean };
}

/** Everything still missing before the salon may be submitted. Empty = ready. */
export function onboardingIssues(s: Snapshot): Issue[] {
    const issues: Issue[] = [];
    const add = (step: StepKey, messages: string[]) => messages.forEach((message) => issues.push({ step, message }));

    add("business", businessProblems(s.business));
    if (!s.hasSlug) add("business", ["Your salon has no web address yet. Please contact SalonOx support."]);

    const location = locationProblems(s.location);
    add("location", location.length ? location : s.location.confirmed ? [] : ["Press Confirm Location."]);

    add("photos", photoProblems(s.photos));

    if (!s.services.some((x) => x.is_listed)) add("services", ["Publish at least one service that is open for online booking."]);
    else if (!s.saved.services) add("services", ["Review your services and save this step."]);

    const availability: string[] = [];
    if (!s.staff.some((m) => m.shown)) availability.push("Show at least one active staff member.");
    if (!s.hasOpenDay) availability.push("Set your business hours: at least one day must be open.");
    if (!availability.length && !s.saved.availability) availability.push("Review staff and hours, then save this step.");
    add("availability", availability);

    if (!s.saved.preferences) add("preferences", ["Save your booking preferences."]);
    return issues;
}

/**
 * What the owner sees. "approved" becomes "active" only while the profile is really visible to customers.
 * A draft that has reached the last step but still has gaps is "setup_incomplete".
 */
export function displayStatus(row: { status: StoredStatus; current_step: number } | null, hasIssues: boolean, isLive: boolean): DisplayStatus {
    if (!row) return "not_started";
    if (row.status === "approved") return isLive ? "active" : "approved";
    if (row.status === "submitted" || row.status === "rejected") return row.status;
    return row.current_step >= STEPS.length && hasIssues ? "setup_incomplete" : "in_progress";
}

export interface ServiceSetting { is_listed: boolean; display_price: string | number | null }

/** The salon's services as the Marketplace shows them: hidden ones removed, Marketplace price applied. */
export function applyServiceSettings<T extends { id: string; price: unknown }>(services: T[], settings: Map<string, ServiceSetting>): T[] {
    return services
        .filter((s) => settings.get(String(s.id))?.is_listed !== false)
        .map((s) => {
            const price = settings.get(String(s.id))?.display_price;
            return price === null || price === undefined ? s : { ...s, price: String(price) };
        });
}
