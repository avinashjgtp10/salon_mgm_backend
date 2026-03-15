"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCheckoutAppointment = exports.validateUpdateAppointment = exports.validateCreateAppointment = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
// ─── Helpers ──────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v) => v === undefined || v === null || isUUID(v);
const isOptionalStr = (v) => v === undefined || v === null || typeof v === "string";
const isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
const isOptionalPositiveNum = (v) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isISODatetime = (v) => typeof v === "string" && !Number.isNaN(new Date(v).getTime());
const VALID_ITEM_TYPES = ["service", "product", "membership", "gift_card"];
// ─── Create Appointment ───────────────────────────────────────────────────────
const validateCreateAppointment = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isUUID(b.salon_id))
            throw new error_middleware_1.AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");
        for (const f of ["branch_id", "client_id", "staff_id", "service_id"]) {
            if (!isOptionalUUID(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a UUID`, "VALIDATION_ERROR");
        }
        if (!isISODatetime(b.scheduled_at))
            throw new error_middleware_1.AppError(400, "scheduled_at is required and must be a valid ISO datetime", "VALIDATION_ERROR");
        if (!isPositiveInt(b.duration_minutes))
            throw new error_middleware_1.AppError(400, "duration_minutes is required and must be a positive integer", "VALIDATION_ERROR");
        for (const f of ["title", "notes", "colour"]) {
            if (!isOptionalStr(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateAppointment = validateCreateAppointment;
// ─── Update / Reschedule ──────────────────────────────────────────────────────
const validateUpdateAppointment = (req, _res, next) => {
    try {
        const b = req.body;
        for (const f of ["branch_id", "client_id", "staff_id", "service_id"]) {
            if (!isOptionalUUID(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a UUID`, "VALIDATION_ERROR");
        }
        if (b.scheduled_at !== undefined && !isISODatetime(b.scheduled_at))
            throw new error_middleware_1.AppError(400, "scheduled_at must be a valid ISO datetime", "VALIDATION_ERROR");
        if (b.duration_minutes !== undefined && !isPositiveInt(b.duration_minutes))
            throw new error_middleware_1.AppError(400, "duration_minutes must be a positive integer", "VALIDATION_ERROR");
        for (const f of ["title", "notes", "colour"]) {
            if (!isOptionalStr(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateAppointment = validateUpdateAppointment;
// ─── Checkout ─────────────────────────────────────────────────────────────────
const validateCheckoutAppointment = (req, _res, next) => {
    try {
        const b = req.body;
        if (!Array.isArray(b.items) || b.items.length === 0)
            throw new error_middleware_1.AppError(400, "items must be a non-empty array", "VALIDATION_ERROR");
        for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (!VALID_ITEM_TYPES.includes(item.item_type))
                throw new error_middleware_1.AppError(400, `items[${i}].item_type must be one of: ${VALID_ITEM_TYPES.join(", ")}`, "VALIDATION_ERROR");
            if (!isOptionalUUID(item.item_id))
                throw new error_middleware_1.AppError(400, `items[${i}].item_id must be a UUID`, "VALIDATION_ERROR");
            if (typeof item.name !== "string" || item.name.trim().length === 0)
                throw new error_middleware_1.AppError(400, `items[${i}].name is required`, "VALIDATION_ERROR");
            if (!isPositiveInt(item.quantity))
                throw new error_middleware_1.AppError(400, `items[${i}].quantity must be a positive integer`, "VALIDATION_ERROR");
            if (!isOptionalPositiveNum(item.unit_price))
                throw new error_middleware_1.AppError(400, `items[${i}].unit_price must be >= 0`, "VALIDATION_ERROR");
            if (!isOptionalPositiveNum(item.discount_amount))
                throw new error_middleware_1.AppError(400, `items[${i}].discount_amount must be >= 0`, "VALIDATION_ERROR");
            if (!isOptionalUUID(item.staff_id))
                throw new error_middleware_1.AppError(400, `items[${i}].staff_id must be a UUID`, "VALIDATION_ERROR");
        }
        for (const f of ["discount_amount", "tip_amount", "tax_amount"]) {
            if (!isOptionalPositiveNum(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a non-negative number`, "VALIDATION_ERROR");
        }
        if (!isOptionalStr(b.notes))
            throw new error_middleware_1.AppError(400, "notes must be a string", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCheckoutAppointment = validateCheckoutAppointment;
//# sourceMappingURL=calendar.validator.js.map