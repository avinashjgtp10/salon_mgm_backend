import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { AppointmentStatus } from "./appointments.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown) => v === undefined || isUUID(v);
const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";
const isISODatetime = (v: unknown) => typeof v === "string" && !isNaN(new Date(v).getTime());

const VALID_STATUSES: AppointmentStatus[] = [
    "booked", "confirmed", "in_progress", "completed", "cancelled", "no_show",
];

export const validateCreateAppointment = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!isUUID(b.salon_id))
            throw new AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.client_id))
            throw new AppError(400, "client_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.staff_id))
            throw new AppError(400, "staff_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.service_id))
            throw new AppError(400, "service_id must be a UUID", "VALIDATION_ERROR");
        if (!isISODatetime(b.scheduled_at))
            throw new AppError(400, "scheduled_at is required and must be a valid ISO datetime", "VALIDATION_ERROR");
        if (typeof b.duration_minutes !== "number" || !Number.isInteger(b.duration_minutes) || b.duration_minutes <= 0)
            throw new AppError(400, "duration_minutes is required and must be a positive integer", "VALIDATION_ERROR");
        if (b.status !== undefined && !VALID_STATUSES.includes(b.status))
            throw new AppError(400, `status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalString(b.notes))
            throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        return next();
    } catch (err) { return next(err); }
};

export const validateUpdateAppointment = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!isOptionalUUID(b.client_id)) throw new AppError(400, "client_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.staff_id)) throw new AppError(400, "staff_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.service_id)) throw new AppError(400, "service_id must be a UUID", "VALIDATION_ERROR");
        if (b.scheduled_at !== undefined && !isISODatetime(b.scheduled_at))
            throw new AppError(400, "scheduled_at must be a valid ISO datetime", "VALIDATION_ERROR");
        if (b.duration_minutes !== undefined && (typeof b.duration_minutes !== "number" || b.duration_minutes <= 0))
            throw new AppError(400, "duration_minutes must be a positive integer", "VALIDATION_ERROR");
        if (b.status !== undefined && !VALID_STATUSES.includes(b.status))
            throw new AppError(400, `status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR");
        if (!isOptionalString(b.notes)) throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        return next();
    } catch (err) { return next(err); }
};

export const validateCheckoutAppointment = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!Array.isArray(b.items) || b.items.length === 0)
            throw new AppError(400, "items must be a non-empty array", "VALIDATION_ERROR");
        const VALID_ITEM_TYPES = ["service", "product", "membership", "gift_card"];
        for (const [i, item] of b.items.entries()) {
            if (!VALID_ITEM_TYPES.includes(item.item_type))
                throw new AppError(400, `items[${i}].item_type is invalid`, "VALIDATION_ERROR");
            if (typeof item.name !== "string" || item.name.trim().length === 0)
                throw new AppError(400, `items[${i}].name is required`, "VALIDATION_ERROR");
            if (typeof item.quantity !== "number" || item.quantity <= 0)
                throw new AppError(400, `items[${i}].quantity must be positive`, "VALIDATION_ERROR");
            if (typeof item.unit_price !== "number" || item.unit_price < 0)
                throw new AppError(400, `items[${i}].unit_price must be non-negative`, "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
