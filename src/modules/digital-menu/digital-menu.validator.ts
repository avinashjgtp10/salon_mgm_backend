import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isEnum = (v: unknown, allowed: string[]) => v === undefined || allowed.includes(String(v));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const validateSelectedServiceIds = (v: unknown): void => {
  if (v === undefined) return;
  if (!Array.isArray(v) || !v.every((x) => isUUID(x))) {
    throw new AppError(400, "selected_service_ids must be an array of valid UUID strings", "VALIDATION_ERROR");
  }
};

export const validateSaveDigitalMenu = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (!isNonEmptyString(b.name)) throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isEnum(b.status, ["active", "inactive"])) {
      throw new AppError(400, "status must be: active | inactive", "VALIDATION_ERROR");
    }
    if (!isEnum(b.service_selection_mode, ["all_active", "specific"])) {
      throw new AppError(400, "service_selection_mode must be: all_active | specific", "VALIDATION_ERROR");
    }
    validateSelectedServiceIds(b.selected_service_ids);
    next();
  } catch (err) {
    next(err);
  }
};
