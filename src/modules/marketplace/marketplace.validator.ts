import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { Amenity, Highlight, Value } from "./marketplace.types";

// ─── Allowed values ───────────────────────────────────────────────────────────

const VALID_AMENITIES: Amenity[] = [
  "parking_available","near_public_transport","showers",
  "lockers","bath_towels","swimming_pool","sauna",
];
const VALID_HIGHLIGHTS: Highlight[] = [
  "pet_friendly","adults_only","kid_friendly","wheelchair_accessible",
];
const VALID_VALUES: Value[] = [
  "organic_products_only","vegan_products_only","environmentally_friendly",
  "lgbtq_plus","black_owned","woman_owned","asian_owned",
  "hispanic_owned","indigenous_owned",
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const URL_RE  = /^https?:\/\/.+/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isNonEmpty      = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptStr        = (v: unknown) => v === undefined || v === null || typeof v === "string";
const isOptNum        = (v: unknown) => v === undefined || v === null || (typeof v === "number" && isFinite(v));
const isValidTime     = (v: unknown) => typeof v === "string" && TIME_RE.test(v);
const isOptEnumArr    = <T extends string>(v: unknown, allowed: T[]) =>
  v === undefined || (Array.isArray(v) && v.every((x) => (allowed as string[]).includes(x)));

// ─── Essentials ───────────────────────────────────────────────────────────────

export const validateUpsertEssentials = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isNonEmpty(b.display_name))
      throw new AppError(400, "display_name is required", "VALIDATION_ERROR");

    if (!isOptStr(b.tagline) || (typeof b.tagline === "string" && b.tagline.length > 80))
      throw new AppError(400, "tagline must be a string of 80 characters or fewer", "VALIDATION_ERROR");

    if (!isOptStr(b.website) || (typeof b.website === "string" && b.website.length > 0 && !URL_RE.test(b.website)))
      throw new AppError(400, "website must be a valid URL", "VALIDATION_ERROR");

    if (!isOptStr(b.business_phone))
      throw new AppError(400, "business_phone must be a string", "VALIDATION_ERROR");

    if (!isOptStr(b.business_phone_country_code))
      throw new AppError(400, "business_phone_country_code must be a string", "VALIDATION_ERROR");

    if (b.business_email != null && (typeof b.business_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.business_email)))
      throw new AppError(400, "business_email must be a valid email", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

// ─── About ────────────────────────────────────────────────────────────────────

export const validateUpsertAbout = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (typeof b.venue_description !== "string")
      throw new AppError(400, "venue_description must be a string", "VALIDATION_ERROR");

    if (b.venue_description.length > 2000)
      throw new AppError(400, "venue_description must be 2000 characters or fewer", "VALIDATION_ERROR");

    // Social links are shown to the public and opened in a new tab, so only
    // http(s) is accepted — a javascript: or data: URL here would otherwise be
    // rendered straight into the booking page's markup.
    for (const field of ["instagram_url", "facebook_url"] as const) {
      const value = b[field];
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string")
        throw new AppError(400, `${field} must be a string`, "VALIDATION_ERROR");
      if (value.length > 255)
        throw new AppError(400, `${field} must be 255 characters or fewer`, "VALIDATION_ERROR");
      let parsed: URL;
      try { parsed = new URL(value); }
      catch { throw new AppError(400, `${field} must be a valid URL starting with http:// or https://`, "VALIDATION_ERROR"); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new AppError(400, `${field} must start with http:// or https://`, "VALIDATION_ERROR");
    }

    if (b.about_enabled !== undefined && typeof b.about_enabled !== "boolean")
      throw new AppError(400, "about_enabled must be a boolean", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

// ─── Booking Policy ─────────────────────────────────────────────────────────────

const isOptPosInt = (v: unknown) =>
  v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0);

export const validateUpsertBookingPolicy = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    // Upper bounds mirror the Booking Settings inputs. Both fields are now free
    // text rather than a fixed dropdown, so an unbounded value can reach here.
    if (!isOptPosInt(b.max_advance_days))
      throw new AppError(400, "max_advance_days must be a non-negative integer", "VALIDATION_ERROR");
    if (b.max_advance_days !== undefined && b.max_advance_days > 365)
      throw new AppError(400, "max_advance_days cannot exceed 365", "VALIDATION_ERROR");
    if (!isOptPosInt(b.min_notice_hours))
      throw new AppError(400, "min_notice_hours must be a non-negative integer", "VALIDATION_ERROR");
    if (b.min_notice_hours !== undefined && b.min_notice_hours > 720)
      throw new AppError(400, "min_notice_hours cannot exceed 720 (30 days)", "VALIDATION_ERROR");
    if (!isOptPosInt(b.cancellation_notice_hours))
      throw new AppError(400, "cancellation_notice_hours must be a non-negative integer", "VALIDATION_ERROR");
    if (!isOptPosInt(b.slot_interval_minutes))
      throw new AppError(400, "slot_interval_minutes must be a non-negative integer", "VALIDATION_ERROR");
    if (b.allow_same_day_booking !== undefined && typeof b.allow_same_day_booking !== "boolean")
      throw new AppError(400, "allow_same_day_booking must be a boolean", "VALIDATION_ERROR");
    if (b.allow_multiple_services !== undefined && typeof b.allow_multiple_services !== "boolean")
      throw new AppError(400, "allow_multiple_services must be a boolean", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

// ─── Theme colour ───────────────────────────────────────────────────────────────

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

// WCAG relative luminance / contrast ratio. The accent is used both as a
// background (white text on it) and as TEXT/link colour on the page's white
// surface, so it has to stay readable against white.
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
/** Minimum contrast vs white (WCAG "3:1" for large text / UI components). */
export const MIN_THEME_CONTRAST_ON_WHITE = 3;
export const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

export const validateUpsertTheme = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const c = req.body?.theme_color;
    // null = back to the default colour.
    if (c === null) return next();
    if (typeof c !== "string" || !HEX6_RE.test(c))
      throw new AppError(400, "theme_color must be a colour like #1e4634 (or null for the default)", "VALIDATION_ERROR");
    if (contrastOnWhite(c) < MIN_THEME_CONTRAST_ON_WHITE)
      throw new AppError(400, "That colour is too light to read on the booking page. Please choose a darker shade.", "VALIDATION_ERROR");
    // Normalise so the stored value is always lower-case #rrggbb.
    req.body.theme_color = c.toLowerCase();
    return next();
  } catch (err) { return next(err); }
};

// ─── Booking page heading ─────────────────────────────────────────────────────────

export const HEADLINE_MAX = 60;
export const SUBHEADLINE_MAX = 140;

// Control characters (incl. newlines/tabs) never belong in a one-line heading.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** undefined/null/blank -> null (= use the built-in default); else the trimmed string. */
const cleanText = (v: unknown, label: string, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new AppError(400, `${label} must be text`, "VALIDATION_ERROR");
  const t = v.replace(/\s+/g, " ").trim();
  if (t === "") return null;
  if (CONTROL_RE.test(t)) throw new AppError(400, `${label} contains invalid characters`, "VALIDATION_ERROR");
  if (t.length > max) throw new AppError(400, `${label} must be ${max} characters or fewer`, "VALIDATION_ERROR");
  return t;
};

export const validateUpsertHeadline = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    // Rendered by React (escaped), but keep angle-bracket markup out of stored
    // copy anyway so it can never be mis-rendered by another consumer later.
    const headline = cleanText(b.booking_headline, "Heading", HEADLINE_MAX);
    const sub = cleanText(b.booking_subheadline, "Subtitle", SUBHEADLINE_MAX);
    if ((headline && /[<>]/.test(headline)) || (sub && /[<>]/.test(sub)))
      throw new AppError(400, "Heading and subtitle can't contain < or >", "VALIDATION_ERROR");
    req.body = { booking_headline: headline, booking_subheadline: sub };
    return next();
  } catch (err) { return next(err); }
};

// ─── Location ─────────────────────────────────────────────────────────────────

export const validateUpsertLocation = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isNonEmpty(b.address_line))
      throw new AppError(400, "address_line is required", "VALIDATION_ERROR");

    for (const f of ["city","state","country","postal_code"]) {
      if (!isOptStr(b[f]))
        throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
    }

    if (!isOptNum(b.latitude))
      throw new AppError(400, "latitude must be a number", "VALIDATION_ERROR");

    if (!isOptNum(b.longitude))
      throw new AppError(400, "longitude must be a number", "VALIDATION_ERROR");

    if (b.latitude != null && (b.latitude < -90 || b.latitude > 90))
      throw new AppError(400, "latitude must be between -90 and 90", "VALIDATION_ERROR");

    if (b.longitude != null && (b.longitude < -180 || b.longitude > 180))
      throw new AppError(400, "longitude must be between -180 and 180", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

// ─── Working Hours ────────────────────────────────────────────────────────────

export const validateUpsertWorkingHours = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!Array.isArray(b.days) || b.days.length === 0 || b.days.length > 7)
      throw new AppError(400, "days must be an array of 1 to 7 items", "VALIDATION_ERROR");

    const seen = new Set<number>();
    for (let i = 0; i < b.days.length; i++) {
      const d = b.days[i];

      if (typeof d.day_of_week !== "number" || !Number.isInteger(d.day_of_week) || d.day_of_week < 0 || d.day_of_week > 6)
        throw new AppError(400, `days[${i}].day_of_week must be 0–6`, "VALIDATION_ERROR");

      if (seen.has(d.day_of_week))
        throw new AppError(400, `Duplicate day_of_week: ${d.day_of_week}`, "VALIDATION_ERROR");
      seen.add(d.day_of_week);

      if (typeof d.is_open !== "boolean")
        throw new AppError(400, `days[${i}].is_open must be a boolean`, "VALIDATION_ERROR");

      if (d.is_open) {
        if (!Array.isArray(d.slots) || d.slots.length === 0)
          throw new AppError(400, `days[${i}].slots must be non-empty when is_open is true`, "VALIDATION_ERROR");

        for (let s = 0; s < d.slots.length; s++) {
          if (!isValidTime(d.slots[s].open_time))
            throw new AppError(400, `days[${i}].slots[${s}].open_time must be HH:MM or HH:MM:SS`, "VALIDATION_ERROR");
          if (!isValidTime(d.slots[s].close_time))
            throw new AppError(400, `days[${i}].slots[${s}].close_time must be HH:MM or HH:MM:SS`, "VALIDATION_ERROR");
        }
      }
    }
    return next();
  } catch (err) { return next(err); }
};

// ─── Images ───────────────────────────────────────────────────────────────────

export const validateAddImage = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    const hasFile = !!(req as any).file;

    if (!hasFile && (typeof b.image_url !== "string" || !URL_RE.test(b.image_url)))
      throw new AppError(400, "image_url must be a valid URL", "VALIDATION_ERROR");

    if (b.is_cover !== undefined && typeof b.is_cover !== "boolean")
      throw new AppError(400, "is_cover must be a boolean", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

export const validateReorderImages = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!Array.isArray(b.image_ids) || b.image_ids.length === 0)
      throw new AppError(400, "image_ids must be a non-empty array of UUIDs", "VALIDATION_ERROR");

    if (!b.image_ids.every((id: unknown) => typeof id === "string"))
      throw new AppError(400, "Each image_id must be a string UUID", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

// ─── Features ─────────────────────────────────────────────────────────────────

export const validateUpsertFeatures = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isOptEnumArr(b.amenities, VALID_AMENITIES))
      throw new AppError(400, `amenities must be an array of: ${VALID_AMENITIES.join(", ")}`, "VALIDATION_ERROR");

    if (!isOptEnumArr(b.highlights, VALID_HIGHLIGHTS))
      throw new AppError(400, `highlights must be an array of: ${VALID_HIGHLIGHTS.join(", ")}`, "VALIDATION_ERROR");

    if (!isOptEnumArr(b.values, VALID_VALUES))
      throw new AppError(400, `values must be an array of: ${VALID_VALUES.join(", ")}`, "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

// ─── Staff Visibility ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validateSetStaffVisibility = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { staff_id, visible } = req.body ?? {};
    if (!isNonEmpty(staff_id) || !UUID_RE.test(staff_id.trim())) {
      throw new AppError(400, "staff_id must be a valid UUID", "VALIDATION_ERROR");
    }
    if (typeof visible !== "boolean") {
      throw new AppError(400, "visible must be a boolean", "VALIDATION_ERROR");
    }
    return next();
  } catch (err) { return next(err); }
};