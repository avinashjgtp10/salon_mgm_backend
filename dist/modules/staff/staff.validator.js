"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAcceptInvitation = exports.validateUpdateStaffLeave = exports.validateCreateStaffLeave = exports.validateUpsertStaffSchedules = exports.validateUpdatePayRun = exports.validateUpdateCommission = exports.validateUpdateWageSettings = exports.validateUpdateEmergencyContact = exports.validateCreateEmergencyContact = exports.validateUpdateStaffAddress = exports.validateCreateStaffAddress = exports.validateUpdateStaff = exports.validateCreateStaff = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
// ─── Helpers ──────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v) => v === undefined || isUUID(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v) => v === undefined || typeof v === "string";
const isOptionalInt = (v) => v === undefined ||
    (typeof v === "number" && Number.isInteger(v) && v >= 0);
const isOptionalNumber = (v) => v === undefined ||
    v === null ||
    (typeof v === "number" && Number.isFinite(v));
const isOptionalBool = (v) => v === undefined || typeof v === "boolean";
const isOptionalStringArray = (v) => v === undefined ||
    (Array.isArray(v) && v.every((x) => typeof x === "string"));
const isOptionalISODate = (v) => {
    if (v === undefined)
        return true;
    if (typeof v !== "string")
        return false;
    return !Number.isNaN(new Date(v).getTime());
};
const VALID_CALENDAR_COLORS = [
    "light_blue", "blue", "dark_blue", "purple", "violet", "pink", "hot_pink", "rose",
    "orange", "yellow", "lime", "green", "teal", "cyan",
];
const VALID_EMPLOYMENT_TYPES = [
    "full_time", "part_time", "contract", "intern", "freelance",
];
const VALID_COMPENSATION_TYPES = [
    "none", "hourly", "salary", "commission",
];
const VALID_COMMISSION_KINDS = ["fixed_rate", "percentage"];
const VALID_COMMISSION_CATEGORIES = [
    "services", "products", "memberships", "gift_cards", "cancellation",
];
const VALID_TIMESHEET_AUTOMATIONS = [
    "workspace_default", "enabled", "disabled",
];
const VALID_PAY_RUN_CALCULATIONS = ["automatic", "manual"];
const VALID_PAYMENT_METHODS = ["pay_manually", "bank_transfer"];
const VALID_RELATIONSHIPS = [
    "spouse", "parent", "sibling", "child", "friend", "colleague", "other",
];
const isOptionalEnum = (v, allowed) => v === undefined || (typeof v === "string" && allowed.includes(v));
// ─── Staff ────────────────────────────────────────────────────────────────────
const validateCreateStaff = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.first_name))
            throw new error_middleware_1.AppError(400, "first_name is required and must be a non-empty string", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))
            throw new error_middleware_1.AppError(400, "email is required and must be a valid email address", "VALIDATION_ERROR");
        for (const f of ["last_name", "phone", "phone_country_code", "additional_phone", "country", "job_title", "staff_external_id", "employee_code"]) {
            if (!isOptionalString(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        if (!isOptionalEnum(b.calendar_color, VALID_CALENDAR_COLORS))
            throw new error_middleware_1.AppError(400, `calendar_color must be one of: ${VALID_CALENDAR_COLORS.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalEnum(b.employment_type, VALID_EMPLOYMENT_TYPES))
            throw new error_middleware_1.AppError(400, `employment_type must be one of: ${VALID_EMPLOYMENT_TYPES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalUUID(b.branch_id))
            throw new error_middleware_1.AppError(400, "branch_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalInt(b.experience_years) || (b.experience_years !== undefined && b.experience_years > 100))
            throw new error_middleware_1.AppError(400, "experience_years must be an integer between 0 and 100", "VALIDATION_ERROR");
        if (!isOptionalStringArray(b.specialization))
            throw new error_middleware_1.AppError(400, "specialization must be an array of strings", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateStaff = validateCreateStaff;
const validateUpdateStaff = (req, _res, next) => {
    try {
        const b = req.body;
        if (b.first_name !== undefined && !isNonEmptyString(b.first_name))
            throw new error_middleware_1.AppError(400, "first_name must be a non-empty string", "VALIDATION_ERROR");
        if (b.email !== undefined && (typeof b.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)))
            throw new error_middleware_1.AppError(400, "email must be a valid email address", "VALIDATION_ERROR");
        for (const f of ["last_name", "phone", "phone_country_code", "additional_phone", "country", "job_title", "staff_external_id", "employee_code"]) {
            if (!isOptionalString(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }
        if (!isOptionalEnum(b.calendar_color, VALID_CALENDAR_COLORS))
            throw new error_middleware_1.AppError(400, `calendar_color must be one of: ${VALID_CALENDAR_COLORS.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalEnum(b.employment_type, VALID_EMPLOYMENT_TYPES))
            throw new error_middleware_1.AppError(400, `employment_type must be one of: ${VALID_EMPLOYMENT_TYPES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalUUID(b.branch_id))
            throw new error_middleware_1.AppError(400, "branch_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalInt(b.experience_years) || (b.experience_years !== undefined && b.experience_years > 100))
            throw new error_middleware_1.AppError(400, "experience_years must be an integer between 0 and 100", "VALIDATION_ERROR");
        if (!isOptionalStringArray(b.specialization))
            throw new error_middleware_1.AppError(400, "specialization must be an array of strings", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateStaff = validateUpdateStaff;
// ─── Address ──────────────────────────────────────────────────────────────────
const validateCreateStaffAddress = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.address_name))
            throw new error_middleware_1.AppError(400, "address_name is required and must be a non-empty string", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.address))
            throw new error_middleware_1.AppError(400, "address is required and must be a non-empty string", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateStaffAddress = validateCreateStaffAddress;
const validateUpdateStaffAddress = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isOptionalString(b.address_name))
            throw new error_middleware_1.AppError(400, "address_name must be a string", "VALIDATION_ERROR");
        if (!isOptionalString(b.address))
            throw new error_middleware_1.AppError(400, "address must be a string", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateStaffAddress = validateUpdateStaffAddress;
// ─── Emergency Contact ────────────────────────────────────────────────────────
const validateCreateEmergencyContact = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.full_name))
            throw new error_middleware_1.AppError(400, "full_name is required and must be a non-empty string", "VALIDATION_ERROR");
        if (!b.relationship || !VALID_RELATIONSHIPS.includes(b.relationship))
            throw new error_middleware_1.AppError(400, `relationship is required and must be one of: ${VALID_RELATIONSHIPS.join(", ")}`, "VALIDATION_ERROR");
        if (!isNonEmptyString(b.phone_number))
            throw new error_middleware_1.AppError(400, "phone_number is required and must be a non-empty string", "VALIDATION_ERROR");
        if (b.email !== undefined && (typeof b.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)))
            throw new error_middleware_1.AppError(400, "email must be a valid email address", "VALIDATION_ERROR");
        if (!isOptionalString(b.phone_country_code))
            throw new error_middleware_1.AppError(400, "phone_country_code must be a string", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateEmergencyContact = validateCreateEmergencyContact;
const validateUpdateEmergencyContact = (req, _res, next) => {
    try {
        const b = req.body;
        if (b.full_name !== undefined && !isNonEmptyString(b.full_name))
            throw new error_middleware_1.AppError(400, "full_name must be a non-empty string", "VALIDATION_ERROR");
        if (!isOptionalEnum(b.relationship, VALID_RELATIONSHIPS))
            throw new error_middleware_1.AppError(400, `relationship must be one of: ${VALID_RELATIONSHIPS.join(", ")}`, "VALIDATION_ERROR");
        if (b.phone_number !== undefined && !isNonEmptyString(b.phone_number))
            throw new error_middleware_1.AppError(400, "phone_number must be a non-empty string", "VALIDATION_ERROR");
        if (b.email !== undefined && (typeof b.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)))
            throw new error_middleware_1.AppError(400, "email must be a valid email address", "VALIDATION_ERROR");
        if (!isOptionalString(b.phone_country_code))
            throw new error_middleware_1.AppError(400, "phone_country_code must be a string", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateEmergencyContact = validateUpdateEmergencyContact;
// ─── Wages ────────────────────────────────────────────────────────────────────
const validateUpdateWageSettings = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isOptionalBool(b.wages_enabled))
            throw new error_middleware_1.AppError(400, "wages_enabled must be a boolean", "VALIDATION_ERROR");
        if (!isOptionalEnum(b.compensation_type, VALID_COMPENSATION_TYPES))
            throw new error_middleware_1.AppError(400, `compensation_type must be one of: ${VALID_COMPENSATION_TYPES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalNumber(b.hourly_rate) || (b.hourly_rate != null && b.hourly_rate < 0))
            throw new error_middleware_1.AppError(400, "hourly_rate must be a non-negative number or null", "VALIDATION_ERROR");
        if (!isOptionalNumber(b.salary_amount) || (b.salary_amount != null && b.salary_amount < 0))
            throw new error_middleware_1.AppError(400, "salary_amount must be a non-negative number or null", "VALIDATION_ERROR");
        for (const f of ["location_restriction", "auto_clock_in", "auto_clock_out", "automated_breaks"]) {
            if (!isOptionalEnum(b[f], VALID_TIMESHEET_AUTOMATIONS))
                throw new error_middleware_1.AppError(400, `${f} must be one of: ${VALID_TIMESHEET_AUTOMATIONS.join(", ")}`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateWageSettings = validateUpdateWageSettings;
// ─── Commission ───────────────────────────────────────────────────────────────
const validateUpdateCommission = (req, _res, next) => {
    try {
        const b = req.body;
        if (!b.category || !VALID_COMMISSION_CATEGORIES.includes(b.category))
            throw new error_middleware_1.AppError(400, `category is required and must be one of: ${VALID_COMMISSION_CATEGORIES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalBool(b.is_enabled))
            throw new error_middleware_1.AppError(400, "is_enabled must be a boolean", "VALIDATION_ERROR");
        if (!isOptionalEnum(b.commission_kind, VALID_COMMISSION_KINDS))
            throw new error_middleware_1.AppError(400, `commission_kind must be one of: ${VALID_COMMISSION_KINDS.join(", ")}`, "VALIDATION_ERROR");
        if (b.default_rate !== undefined && (typeof b.default_rate !== "number" || b.default_rate < 0))
            throw new error_middleware_1.AppError(400, "default_rate must be a non-negative number", "VALIDATION_ERROR");
        for (const f of ["use_default_calculation", "pass_cancellation_fee_late", "pass_cancellation_fee_noshow"]) {
            if (!isOptionalBool(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a boolean`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateCommission = validateUpdateCommission;
// ─── Pay Runs ─────────────────────────────────────────────────────────────────
const validateUpdatePayRun = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isOptionalBool(b.pay_runs_enabled))
            throw new error_middleware_1.AppError(400, "pay_runs_enabled must be a boolean", "VALIDATION_ERROR");
        if (!isOptionalEnum(b.payment_method, VALID_PAYMENT_METHODS))
            throw new error_middleware_1.AppError(400, `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalEnum(b.calculation_type, VALID_PAY_RUN_CALCULATIONS))
            throw new error_middleware_1.AppError(400, `calculation_type must be one of: ${VALID_PAY_RUN_CALCULATIONS.join(", ")}`, "VALIDATION_ERROR");
        for (const f of ["deduct_payment_processing_fees", "deduct_new_client_fees", "record_cash_advances"]) {
            if (!isOptionalBool(b[f]))
                throw new error_middleware_1.AppError(400, `${f} must be a boolean`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdatePayRun = validateUpdatePayRun;
// ─── Schedules ────────────────────────────────────────────────────────────────
const validateUpsertStaffSchedules = (req, _res, next) => {
    try {
        const b = req.body;
        if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 7)
            throw new error_middleware_1.AppError(400, "items must be an array of 1 to 7 schedule entries", "VALIDATION_ERROR");
        for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (typeof item.day_of_week !== "number" || !Number.isInteger(item.day_of_week) || item.day_of_week < 0 || item.day_of_week > 6)
                throw new error_middleware_1.AppError(400, `items[${i}].day_of_week must be an integer between 0 and 6`, "VALIDATION_ERROR");
            if (typeof item.is_available !== "boolean")
                throw new error_middleware_1.AppError(400, `items[${i}].is_available is required and must be a boolean`, "VALIDATION_ERROR");
            if (!isOptionalString(item.start_time))
                throw new error_middleware_1.AppError(400, `items[${i}].start_time must be a string e.g. "10:00:00"`, "VALIDATION_ERROR");
            if (!isOptionalString(item.end_time))
                throw new error_middleware_1.AppError(400, `items[${i}].end_time must be a string e.g. "19:00:00"`, "VALIDATION_ERROR");
            if (item.notes !== undefined && (typeof item.notes !== "string" || item.notes.length > 255))
                throw new error_middleware_1.AppError(400, `items[${i}].notes must be a string max 255 chars`, "VALIDATION_ERROR");
        }
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpsertStaffSchedules = validateUpsertStaffSchedules;
// ─── Leaves ───────────────────────────────────────────────────────────────────
const validateCreateStaffLeave = (req, _res, next) => {
    try {
        const b = req.body;
        if (!b.start_date || !isOptionalISODate(b.start_date))
            throw new error_middleware_1.AppError(400, "start_date is required and must be a valid date (YYYY-MM-DD)", "VALIDATION_ERROR");
        if (!b.end_date || !isOptionalISODate(b.end_date))
            throw new error_middleware_1.AppError(400, "end_date is required and must be a valid date (YYYY-MM-DD)", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.leave_type))
            throw new error_middleware_1.AppError(400, "leave_type is required and must be a non-empty string", "VALIDATION_ERROR");
        if (!isOptionalString(b.status))
            throw new error_middleware_1.AppError(400, "status must be a string", "VALIDATION_ERROR");
        if (b.reason !== undefined && (typeof b.reason !== "string" || b.reason.length > 255))
            throw new error_middleware_1.AppError(400, "reason must be a string max 255 chars", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateCreateStaffLeave = validateCreateStaffLeave;
const validateUpdateStaffLeave = (req, _res, next) => {
    try {
        const b = req.body;
        if (b.start_date !== undefined && !isOptionalISODate(b.start_date))
            throw new error_middleware_1.AppError(400, "start_date must be a valid date (YYYY-MM-DD)", "VALIDATION_ERROR");
        if (b.end_date !== undefined && !isOptionalISODate(b.end_date))
            throw new error_middleware_1.AppError(400, "end_date must be a valid date (YYYY-MM-DD)", "VALIDATION_ERROR");
        if (!isOptionalString(b.leave_type))
            throw new error_middleware_1.AppError(400, "leave_type must be a string", "VALIDATION_ERROR");
        if (!isOptionalString(b.status))
            throw new error_middleware_1.AppError(400, "status must be a string", "VALIDATION_ERROR");
        if (b.reason !== undefined && (typeof b.reason !== "string" || b.reason.length > 255))
            throw new error_middleware_1.AppError(400, "reason must be a string max 255 chars", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateUpdateStaffLeave = validateUpdateStaffLeave;
// ─── Accept Invitation ────────────────────────────────────────────────────────
const validateAcceptInvitation = (req, _res, next) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.token))
            throw new error_middleware_1.AppError(400, "token is required", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.first_name))
            throw new error_middleware_1.AppError(400, "first_name is required and must be a non-empty string", "VALIDATION_ERROR");
        if (typeof b.password !== "string" || b.password.length < 8)
            throw new error_middleware_1.AppError(400, "password is required and must be at least 8 characters", "VALIDATION_ERROR");
        if (!isOptionalString(b.last_name))
            throw new error_middleware_1.AppError(400, "last_name must be a string", "VALIDATION_ERROR");
        return next();
    }
    catch (err) {
        return next(err);
    }
};
exports.validateAcceptInvitation = validateAcceptInvitation;
//# sourceMappingURL=staff.validator.js.map