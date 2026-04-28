import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown) => v === undefined || isUUID(v);

// HH:MM (00:00 – 23:59)
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isTime = (v: unknown) => typeof v === "string" && TIME_RE.test(v);
const isOptionalTime = (v: unknown) => v === undefined || isTime(v);

// YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown) => typeof v === "string" && DATE_RE.test(v) && !isNaN(new Date(v as string).getTime());
const isOptionalDate = (v: unknown) => v === undefined || isDate(v);

export const validateCreateBlockedTime = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isUUID(b.salon_id))
      throw new AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");
    if (!isUUID(b.staff_id))
      throw new AppError(400, "staff_id is required and must be a UUID", "VALIDATION_ERROR");
    if (!isDate(b.date))
      throw new AppError(400, "date is required and must be YYYY-MM-DD", "VALIDATION_ERROR");
    if (!isTime(b.start_time))
      throw new AppError(400, "start_time is required and must be HH:MM", "VALIDATION_ERROR");
    if (!isTime(b.end_time))
      throw new AppError(400, "end_time is required and must be HH:MM", "VALIDATION_ERROR");
    if (b.start_time >= b.end_time)
      throw new AppError(400, "end_time must be after start_time", "VALIDATION_ERROR");
    if (b.reason !== undefined && typeof b.reason !== "string")
      throw new AppError(400, "reason must be a string", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateBlockedTime = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;

    if (!isOptionalUUID(b.staff_id))
      throw new AppError(400, "staff_id must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalDate(b.date))
      throw new AppError(400, "date must be YYYY-MM-DD", "VALIDATION_ERROR");
    if (!isOptionalTime(b.start_time))
      throw new AppError(400, "start_time must be HH:MM", "VALIDATION_ERROR");
    if (!isOptionalTime(b.end_time))
      throw new AppError(400, "end_time must be HH:MM", "VALIDATION_ERROR");

    // If both times are present, enforce ordering
    if (b.start_time && b.end_time && b.start_time >= b.end_time)
      throw new AppError(400, "end_time must be after start_time", "VALIDATION_ERROR");

    if (b.reason !== undefined && typeof b.reason !== "string")
      throw new AppError(400, "reason must be a string", "VALIDATION_ERROR");

    return next();
  } catch (err) { return next(err); }
};
