"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUpsertFeatures = exports.validateReorderImages = exports.validateAddImage = exports.validateUpsertWorkingHours = exports.validateUpsertLocation = exports.validateUpsertAbout = exports.validateUpsertEssentials = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
// ─── Allowed values ───────────────────────────────────────────────────────────
const VALID_AMENITIES = [
    "parking_available", "near_public_transport", "showers",
    "lockers", "bath_towels", "swimming_pool", "sauna",
];
const VALID_HIGHLIGHTS = [
    "pet_friendly", "adults_only", "kid_friendly", "wheelchair_accessible",
];
const VALID_VALUES = [
    "organic_products_only", "vegan_products_only", "environmentally_friendly",
    "lgbtq_plus", "black_owned", "woman_owned", "asian_owned",
    "hispanic_owned", "indigenous_owned",
];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const URL_RE = /^https?:\/\/.+/;
// ─── Helpers ──────────────────────────────────────────────────────────────────
const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v) => v === undefined || v === null || typeof v === "string";
const isOptNum = (v) => v === undefined || v === null || (typeof v === "number" && isFinite(v));
const isValidTime = (v) => typeof v === "string" && TIME_RE.test(v);
const isOptEnumArr = (v, allowed) => v === undefined || (Array.isArray(v) && v.every((x) => allowed.includes(x)));
// ─── Essentials ───────────────────────────────────────────────────────────────
const validateUpsertEssentials = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmpty(b.display_name))
            throw new error_middleware_1.AppError(400, "display_name is required", "VALIDATION_ERROR");
        if (!isOptStr(b.business_phone))
            throw new error_middleware_1.AppError(400, "business_phone must be a string", "VALIDATION_ERROR");
        if (!isOptStr(b.business_phone_country_code))
            throw new error_middleware_1.AppError(400, "business_phone_country_code must be a string", "VALIDATION_ERROR");
        if (b.business_email != null && (typeof b.business_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.business_email)))
            throw new error_middleware_1.AppError(400, "business_email must be a valid email", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpsertEssentials = validateUpsertEssentials;
// ─── About ────────────────────────────────────────────────────────────────────
const validateUpsertAbout = (req, _res, next) => {
    try {
        const b = req.body;
        if (typeof b.venue_description !== "string")
            throw new error_middleware_1.AppError(400, "venue_description must be a string", "VALIDATION_ERROR");
        if (b.venue_description.length > 2000)
            throw new error_middleware_1.AppError(400, "venue_description must be 2000 characters or fewer", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpsertAbout = validateUpsertAbout;
// ─── Location ─────────────────────────────────────────────────────────────────
const validateUpsertLocation = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmpty(b.address_line))
            throw new error_middleware_1.AppError(400, "address_line is required", "VALIDATION_ERROR");
        for (const f of ["city", "state", "country", "postal_code"]) {
            if (!isOptStr(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        if (!isOptNum(b.latitude))
            throw new error_middleware_1.AppError(400, "latitude must be a number", "VALIDATION_ERROR");
        if (!isOptNum(b.longitude))
            throw new error_middleware_1.AppError(400, "longitude must be a number", "VALIDATION_ERROR");
        if (b.latitude != null && (b.latitude < -90 || b.latitude > 90))
            throw new error_middleware_1.AppError(400, "latitude must be between -90 and 90", "VALIDATION_ERROR");
        if (b.longitude != null && (b.longitude < -180 || b.longitude > 180))
            throw new error_middleware_1.AppError(400, "longitude must be between -180 and 180", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpsertLocation = validateUpsertLocation;
// ─── Working Hours ────────────────────────────────────────────────────────────
const validateUpsertWorkingHours = (req, _res, next) => {
    try {
        const b = req.body;
        if (!Array.isArray(b.days) || b.days.length === 0 || b.days.length > 7)
            throw new error_middleware_1.AppError(400, "days must be an array of 1 to 7 items", "VALIDATION_ERROR");
        const seen = new Set();
        for (let i = 0; i < b.days.length; i++) {
            const d = b.days[i];
            if (typeof d.day_of_week !== "number" || !Number.isInteger(d.day_of_week) || d.day_of_week < 0 || d.day_of_week > 6)
                throw new error_middleware_1.AppError(400, `days[${i}].day_of_week must be 0–6`, "VALIDATION_ERROR");
            if (seen.has(d.day_of_week))
                throw new error_middleware_1.AppError(400, `Duplicate day_of_week: ${d.day_of_week}`, "VALIDATION_ERROR");
            seen.add(d.day_of_week);
            if (typeof d.is_open !== "boolean")
                throw new error_middleware_1.AppError(400, `days[${i}].is_open must be a boolean`, "VALIDATION_ERROR");
            if (d.is_open) {
                if (!Array.isArray(d.slots) || d.slots.length === 0)
                    throw new error_middleware_1.AppError(400, `days[${i}].slots must be non-empty when is_open is true`, "VALIDATION_ERROR");
                for (let s = 0; s < d.slots.length; s++) {
                    if (!isValidTime(d.slots[s].open_time))
                        throw new error_middleware_1.AppError(400, `days[${i}].slots[${s}].open_time must be HH:MM or HH:MM:SS`, "VALIDATION_ERROR");
                    if (!isValidTime(d.slots[s].close_time))
                        throw new error_middleware_1.AppError(400, `days[${i}].slots[${s}].close_time must be HH:MM or HH:MM:SS`, "VALIDATION_ERROR");
                }
            }
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpsertWorkingHours = validateUpsertWorkingHours;
// ─── Images ───────────────────────────────────────────────────────────────────
const validateAddImage = (req, _res, next) => {
    try {
        const b = req.body;
        if (typeof b.image_url !== "string" || !URL_RE.test(b.image_url))
            throw new error_middleware_1.AppError(400, "image_url must be a valid URL", "VALIDATION_ERROR");
        if (b.is_cover !== undefined && typeof b.is_cover !== "boolean")
            throw new error_middleware_1.AppError(400, "is_cover must be a boolean", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateAddImage = validateAddImage;
const validateReorderImages = (req, _res, next) => {
    try {
        const b = req.body;
        if (!Array.isArray(b.image_ids) || b.image_ids.length === 0)
            throw new error_middleware_1.AppError(400, "image_ids must be a non-empty array of UUIDs", "VALIDATION_ERROR");
        if (!b.image_ids.every((id) => typeof id === "string"))
            throw new error_middleware_1.AppError(400, "Each image_id must be a string UUID", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateReorderImages = validateReorderImages;
// ─── Features ─────────────────────────────────────────────────────────────────
const validateUpsertFeatures = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isOptEnumArr(b.amenities, VALID_AMENITIES))
            throw new error_middleware_1.AppError(400, `amenities must be an array of: ${VALID_AMENITIES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptEnumArr(b.highlights, VALID_HIGHLIGHTS))
            throw new error_middleware_1.AppError(400, `highlights must be an array of: ${VALID_HIGHLIGHTS.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptEnumArr(b.values, VALID_VALUES))
            throw new error_middleware_1.AppError(400, `values must be an array of: ${VALID_VALUES.join(", ")}`, "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpsertFeatures = validateUpsertFeatures;
//# sourceMappingURL=marketplace.validator.js.map