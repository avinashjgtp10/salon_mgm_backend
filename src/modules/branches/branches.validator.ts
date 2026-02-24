// src/modules/branches/branches.validator.ts

import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isUUID = (v: unknown) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";
const isOptionalBoolean = (v: unknown) => v === undefined || typeof v === "boolean";
const isOptionalNumber = (v: unknown) => v === undefined || typeof v === "number";
const isTimeString = (v: unknown) => typeof v === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(v.trim());
const isOptionalTimeString = (v: unknown) => v === undefined || isTimeString(v);
const isValidDay = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6;
const isDateString = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());

// ---------- BRANCHES ----------
export const validateCreateBranch = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        if (!isNonEmptyString(b.name)) throw new AppError(400, "name is required", "VALIDATION_ERROR");

        if (!isNonEmptyString(b.address_line1)) throw new AppError(400, "address_line1 is required", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.city)) throw new AppError(400, "city is required", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.state)) throw new AppError(400, "state is required", "VALIDATION_ERROR");
        if (!isNonEmptyString(b.pincode)) throw new AppError(400, "pincode is required", "VALIDATION_ERROR");

        const optionalStringFields = ["address_line2", "country", "phone", "email"];
        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) throw new AppError(400, `${f} must be string`, "VALIDATION_ERROR");
        }

        if (!isOptionalNumber(b.latitude)) throw new AppError(400, "latitude must be number", "VALIDATION_ERROR");
        if (!isOptionalNumber(b.longitude)) throw new AppError(400, "longitude must be number", "VALIDATION_ERROR");

        if (!isOptionalBoolean(b.is_main)) throw new AppError(400, "is_main must be boolean", "VALIDATION_ERROR");
        if (!isOptionalTimeString(b.opening_time)) throw new AppError(400, "opening_time must be HH:MM", "VALIDATION_ERROR");
        if (!isOptionalTimeString(b.closing_time)) throw new AppError(400, "closing_time must be HH:MM", "VALIDATION_ERROR");

        if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateBranch = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;

        const optionalStringFields = [
            "name",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "pincode",
            "country",
            "phone",
            "email",
        ];
        for (const f of optionalStringFields) {
            if (!isOptionalString(b[f])) throw new AppError(400, `${f} must be string`, "VALIDATION_ERROR");
        }

        if (!isOptionalNumber(b.latitude)) throw new AppError(400, "latitude must be number", "VALIDATION_ERROR");
        if (!isOptionalNumber(b.longitude)) throw new AppError(400, "longitude must be number", "VALIDATION_ERROR");
        if (!isOptionalBoolean(b.is_main)) throw new AppError(400, "is_main must be boolean", "VALIDATION_ERROR");

        if (!isOptionalTimeString(b.opening_time)) throw new AppError(400, "opening_time must be HH:MM", "VALIDATION_ERROR");
        if (!isOptionalTimeString(b.closing_time)) throw new AppError(400, "closing_time must be HH:MM", "VALIDATION_ERROR");

        if (!isOptionalBoolean(b.is_active)) throw new AppError(400, "is_active must be boolean", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

// ---------- TIMINGS ----------
export const validateSetTimings = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const branchId = String(req.params.id || "").trim();
        if (!isUUID(branchId)) throw new AppError(400, "branch id must be valid UUID", "VALIDATION_ERROR");

        const b = req.body;
        if (!b || !Array.isArray(b.days) || b.days.length === 0) {
            throw new AppError(400, "days must be a non-empty array", "VALIDATION_ERROR");
        }

        const seen = new Set<number>();
        for (const d of b.days) {
            if (!isValidDay(d.day_of_week)) throw new AppError(400, "day_of_week must be 0..6", "VALIDATION_ERROR");
            if (seen.has(d.day_of_week)) throw new AppError(400, `Duplicate day_of_week ${d.day_of_week}`, "VALIDATION_ERROR");
            seen.add(d.day_of_week);

            const isClosed = d.is_closed === true;
            if (isClosed) continue;

            if (!isTimeString(d.opening_time)) throw new AppError(400, `opening_time required for day ${d.day_of_week}`, "VALIDATION_ERROR");
            if (!isTimeString(d.closing_time)) throw new AppError(400, `closing_time required for day ${d.day_of_week}`, "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateReplaceTimings = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const branchId = String(req.params.id || "").trim();
        if (!isUUID(branchId)) throw new AppError(400, "branch id must be valid UUID", "VALIDATION_ERROR");

        const b = req.body;
        if (!b || !Array.isArray(b.days)) throw new AppError(400, "days must be array", "VALIDATION_ERROR");

        const set = new Set<number>();
        for (const d of b.days) {
            if (!isValidDay(d.day_of_week)) throw new AppError(400, "day_of_week must be 0..6", "VALIDATION_ERROR");
            set.add(d.day_of_week);

            const isClosed = d.is_closed === true;
            if (isClosed) continue;

            if (!isTimeString(d.opening_time)) throw new AppError(400, `opening_time required for day ${d.day_of_week}`, "VALIDATION_ERROR");
            if (!isTimeString(d.closing_time)) throw new AppError(400, `closing_time required for day ${d.day_of_week}`, "VALIDATION_ERROR");
        }

        if (set.size !== 7) throw new AppError(400, "PUT timings must include all 7 days (0..6)", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

// ---------- HOLIDAYS ----------
export const validateCreateHoliday = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const branchId = String(req.params.id || "").trim();
        if (!isUUID(branchId)) throw new AppError(400, "branch id must be valid UUID", "VALIDATION_ERROR");

        const b = req.body;
        if (!isDateString(b.holiday_date)) throw new AppError(400, "holiday_date must be YYYY-MM-DD", "VALIDATION_ERROR");
        if (!isOptionalString(b.reason)) throw new AppError(400, "reason must be string", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateHolidayListQuery = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const { from, to } = req.query;

        if (from !== undefined && !isDateString(from)) throw new AppError(400, "from must be YYYY-MM-DD", "VALIDATION_ERROR");
        if (to !== undefined && !isDateString(to)) throw new AppError(400, "to must be YYYY-MM-DD", "VALIDATION_ERROR");

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateDeleteHoliday = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const holidayId = String(req.params.holidayId || "").trim();
        if (!isUUID(holidayId)) throw new AppError(400, "holidayId must be valid UUID", "VALIDATION_ERROR");
        return next();
    } catch (err) {
        return next(err);
    }
};
