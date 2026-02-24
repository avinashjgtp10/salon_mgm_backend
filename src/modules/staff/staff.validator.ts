import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";
const isOptionalBoolean = (v: unknown) => v === undefined || typeof v === "boolean";

const isOptionalStringArray = (v: unknown) =>
    v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));

const isUUID = (v: unknown) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const isOptionalUUID = (v: unknown) => v === undefined || isUUID(v);

const isDateString = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isOptionalDateString = (v: unknown) => v === undefined || isDateString(v);

const isTimeString = (v: unknown) => typeof v === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(v);
const isOptionalTimeString = (v: unknown) => v === undefined || isTimeString(v);

// ------------------------------
// STAFF
// ------------------------------
export const validateCreateStaff = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        // required
        if (!isUUID(b.user_id)) throw new AppError(400, "user_id is required (uuid)", "VALIDATION_ERROR");
        if (!isUUID(b.salon_id)) throw new AppError(400, "salon_id is required (uuid)", "VALIDATION_ERROR");

        // optional
        if (!isOptionalUUID(b.branch_id)) throw new AppError(400, "branch_id must be uuid", "VALIDATION_ERROR");
        if (!isOptionalString(b.designation)) throw new AppError(400, "designation must be string", "VALIDATION_ERROR");
        if (!isOptionalStringArray(b.specialization))
            throw new AppError(400, "specialization must be string[]", "VALIDATION_ERROR");

        if (b.experience_years !== undefined) {
            if (typeof b.experience_years !== "number" || !Number.isInteger(b.experience_years) || b.experience_years < 0) {
                throw new AppError(400, "experience_years must be a non-negative integer", "VALIDATION_ERROR");
            }
        }

        if (!isOptionalString(b.commission_type))
            throw new AppError(400, "commission_type must be string", "VALIDATION_ERROR");

        // allow number or numeric string for commission_value (because many clients send as string)
        if (b.commission_value !== undefined) {
            const ok =
                (typeof b.commission_value === "number" && Number.isFinite(b.commission_value)) ||
                (typeof b.commission_value === "string" && b.commission_value.trim() !== "" && !Number.isNaN(Number(b.commission_value)));
            if (!ok) throw new AppError(400, "commission_value must be a number", "VALIDATION_ERROR");
        }

        if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        if (!isOptionalDateString(b.joined_date))
            throw new AppError(400, "joined_date must be YYYY-MM-DD", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateStaff = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        const optionalUUIDFields = ["user_id", "salon_id", "branch_id"] as const;
        for (const f of optionalUUIDFields) {
            if (b[f] !== undefined && !isUUID(b[f])) {
                throw new AppError(400, `${f} must be uuid`, "VALIDATION_ERROR");
            }
        }

        if (!isOptionalString(b.designation)) throw new AppError(400, "designation must be string", "VALIDATION_ERROR");
        if (!isOptionalStringArray(b.specialization))
            throw new AppError(400, "specialization must be string[]", "VALIDATION_ERROR");

        if (b.experience_years !== undefined) {
            if (typeof b.experience_years !== "number" || !Number.isInteger(b.experience_years) || b.experience_years < 0) {
                throw new AppError(400, "experience_years must be a non-negative integer", "VALIDATION_ERROR");
            }
        }

        if (!isOptionalString(b.commission_type))
            throw new AppError(400, "commission_type must be string", "VALIDATION_ERROR");

        if (b.commission_value !== undefined) {
            const ok =
                (typeof b.commission_value === "number" && Number.isFinite(b.commission_value)) ||
                (typeof b.commission_value === "string" && b.commission_value.trim() !== "" && !Number.isNaN(Number(b.commission_value)));
            if (!ok) throw new AppError(400, "commission_value must be a number", "VALIDATION_ERROR");
        }

        if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");
        if (!isOptionalDateString(b.joined_date))
            throw new AppError(400, "joined_date must be YYYY-MM-DD", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

// ------------------------------
// STAFF SCHEDULES
// ------------------------------
export const validateCreateStaffSchedule = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isUUID(b.staff_id)) throw new AppError(400, "staff_id is required (uuid)", "VALIDATION_ERROR");

        if (typeof b.day_of_week !== "number" || !Number.isInteger(b.day_of_week) || b.day_of_week < 0 || b.day_of_week > 6) {
            throw new AppError(400, "day_of_week must be integer 0-6", "VALIDATION_ERROR");
        }

        if (!isTimeString(b.start_time)) throw new AppError(400, "start_time is required (HH:MM)", "VALIDATION_ERROR");
        if (!isTimeString(b.end_time)) throw new AppError(400, "end_time is required (HH:MM)", "VALIDATION_ERROR");

        if (!isOptionalBoolean(b.is_available))
            throw new AppError(400, "is_available must be boolean", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateStaffSchedule = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (b.staff_id !== undefined && !isUUID(b.staff_id))
            throw new AppError(400, "staff_id must be uuid", "VALIDATION_ERROR");

        if (b.day_of_week !== undefined) {
            if (typeof b.day_of_week !== "number" || !Number.isInteger(b.day_of_week) || b.day_of_week < 0 || b.day_of_week > 6) {
                throw new AppError(400, "day_of_week must be integer 0-6", "VALIDATION_ERROR");
            }
        }

        if (!isOptionalTimeString(b.start_time))
            throw new AppError(400, "start_time must be HH:MM", "VALIDATION_ERROR");

        if (!isOptionalTimeString(b.end_time))
            throw new AppError(400, "end_time must be HH:MM", "VALIDATION_ERROR");

        if (!isOptionalBoolean(b.is_available))
            throw new AppError(400, "is_available must be boolean", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

// ------------------------------
// STAFF LEAVES
// ------------------------------
export const validateCreateStaffLeave = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isUUID(b.staff_id)) throw new AppError(400, "staff_id is required (uuid)", "VALIDATION_ERROR");
        if (!isDateString(b.start_date)) throw new AppError(400, "start_date is required (YYYY-MM-DD)", "VALIDATION_ERROR");
        if (!isDateString(b.end_date)) throw new AppError(400, "end_date is required (YYYY-MM-DD)", "VALIDATION_ERROR");

        if (b.reason !== undefined && !isNonEmptyString(b.reason) && typeof b.reason !== "string") {
            // allow empty string? usually no; but if they pass it, treat as string validation
            throw new AppError(400, "reason must be string", "VALIDATION_ERROR");
        }

        if (!isOptionalString(b.leave_type)) throw new AppError(400, "leave_type must be string", "VALIDATION_ERROR");
        if (!isOptionalString(b.status)) throw new AppError(400, "status must be string", "VALIDATION_ERROR");

        // basic range validation (optional but helpful)
        const sd = new Date(b.start_date);
        const ed = new Date(b.end_date);
        if (!Number.isNaN(sd.getTime()) && !Number.isNaN(ed.getTime()) && ed < sd) {
            throw new AppError(400, "end_date cannot be before start_date", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateStaffLeave = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (b.staff_id !== undefined && !isUUID(b.staff_id))
            throw new AppError(400, "staff_id must be uuid", "VALIDATION_ERROR");

        if (!isOptionalDateString(b.start_date))
            throw new AppError(400, "start_date must be YYYY-MM-DD", "VALIDATION_ERROR");

        if (!isOptionalDateString(b.end_date))
            throw new AppError(400, "end_date must be YYYY-MM-DD", "VALIDATION_ERROR");

        if (!isOptionalString(b.reason)) throw new AppError(400, "reason must be string", "VALIDATION_ERROR");
        if (!isOptionalString(b.leave_type)) throw new AppError(400, "leave_type must be string", "VALIDATION_ERROR");
        if (!isOptionalString(b.status)) throw new AppError(400, "status must be string", "VALIDATION_ERROR");

        // if both provided, validate range
        if (b.start_date && b.end_date) {
            const sd = new Date(b.start_date);
            const ed = new Date(b.end_date);
            if (!Number.isNaN(sd.getTime()) && !Number.isNaN(ed.getTime()) && ed < sd) {
                throw new AppError(400, "end_date cannot be before start_date", "VALIDATION_ERROR");
            }
        }

        return next();
    } catch (err) {
        return next(err);
    }
};
