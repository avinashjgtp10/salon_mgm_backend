import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isNonEmptyString      = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptionalString      = (v: unknown) => v === undefined || typeof v === "string";
const isOptionalBool        = (v: unknown) => v === undefined || typeof v === "boolean";
const isOptionalNumber      = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));
const isOptionalInt         = (v: unknown) => v === undefined || (typeof v === "number" && Number.isInteger(v));
const isOptionalNonNeg      = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const isOptionalStringArray = (v: unknown): v is string[] | undefined =>
  v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));

const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID         = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown) => v === undefined || isUUID(v);
const isEnum         = (v: unknown, allowed: string[]) => v === undefined || allowed.includes(String(v));

const validateUuidArray = (v: unknown, field: string): void => {
  if (!isOptionalStringArray(v))
    throw new AppError(400, `${field} must be an array of strings`, "VALIDATION_ERROR");
  if (v !== undefined && !v.every((x) => isUUID(x)))
    throw new AppError(400, `${field} must contain valid UUID strings`, "VALIDATION_ERROR");
};

// ─── Services ─────────────────────────────────────────────────────────────────

export const validateCreateService = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (!isNonEmptyString(b.name))           throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isUUID(b.category_id))              throw new AppError(400, "category_id is required and must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalString(b.treatment_type)) throw new AppError(400, "treatment_type must be a string", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))    throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isEnum(b.price_type, ["fixed", "from", "free"])) throw new AppError(400, "price_type must be: fixed | from | free", "VALIDATION_ERROR");
    if (!isOptionalNumber(b.price))          throw new AppError(400, "price must be a number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.duration))          throw new AppError(400, "duration must be an integer (minutes)", "VALIDATION_ERROR");
    if (!isOptionalBool(b.online_booking))   throw new AppError(400, "online_booking must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.commission_enabled)) throw new AppError(400, "commission_enabled must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.resource_required))  throw new AppError(400, "resource_required must be a boolean", "VALIDATION_ERROR");
    validateUuidArray(b.staff_ids, "staff_ids");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateService = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalUUID(b.category_id))      throw new AppError(400, "category_id must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalString(b.treatment_type)) throw new AppError(400, "treatment_type must be a string", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))    throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isEnum(b.price_type, ["fixed", "from", "free"])) throw new AppError(400, "price_type must be: fixed | from | free", "VALIDATION_ERROR");
    if (!isOptionalNumber(b.price))          throw new AppError(400, "price must be a number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.duration))          throw new AppError(400, "duration must be an integer", "VALIDATION_ERROR");
    if (!isOptionalBool(b.online_booking))   throw new AppError(400, "online_booking must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.commission_enabled)) throw new AppError(400, "commission_enabled must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.resource_required))  throw new AppError(400, "resource_required must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.is_active))        throw new AppError(400, "is_active must be a boolean", "VALIDATION_ERROR");
    validateUuidArray(b.staff_ids, "staff_ids");
    return next();
  } catch (err) { return next(err); }
};

export const validateCreateAddOnGroup = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (!isNonEmptyString(b.name))              throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isOptionalString(b.prompt_to_client))  throw new AppError(400, "prompt_to_client must be a string", "VALIDATION_ERROR");
    if (!isOptionalInt(b.min_quantity))         throw new AppError(400, "min_quantity must be an integer", "VALIDATION_ERROR");
    if (!isOptionalInt(b.max_quantity))         throw new AppError(400, "max_quantity must be an integer", "VALIDATION_ERROR");
    if (!isOptionalBool(b.allow_multiple_same)) throw new AppError(400, "allow_multiple_same must be a boolean", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateAddOnGroup = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalString(b.prompt_to_client))  throw new AppError(400, "prompt_to_client must be a string", "VALIDATION_ERROR");
    if (!isOptionalInt(b.min_quantity))         throw new AppError(400, "min_quantity must be an integer", "VALIDATION_ERROR");
    if (!isOptionalInt(b.max_quantity))         throw new AppError(400, "max_quantity must be an integer", "VALIDATION_ERROR");
    if (!isOptionalBool(b.allow_multiple_same)) throw new AppError(400, "allow_multiple_same must be a boolean", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

export const validateCreateAddOnOption = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (!isNonEmptyString(b.name))             throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))      throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isOptionalNumber(b.additional_price)) throw new AppError(400, "additional_price must be a number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.additional_duration)) throw new AppError(400, "additional_duration must be an integer", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateAddOnOption = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))      throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isOptionalNumber(b.additional_price)) throw new AppError(400, "additional_price must be a number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.additional_duration)) throw new AppError(400, "additional_duration must be an integer", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

// ─── Bundles ──────────────────────────────────────────────────────────────────

export const validateCreateBundle = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (!isNonEmptyString(b.name))   throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isUUID(b.category_id))      throw new AppError(400, "category_id is required and must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalString(b.description)) throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isEnum(b.schedule_type, ["sequence", "parallel"])) throw new AppError(400, "schedule_type must be: sequence | parallel", "VALIDATION_ERROR");
    if (!isEnum(b.price_type, ["service_pricing", "fixed", "free"])) throw new AppError(400, "price_type must be: service_pricing | fixed | free", "VALIDATION_ERROR");
    if (!isOptionalNonNeg(b.retail_price))     throw new AppError(400, "retail_price must be a non-negative number", "VALIDATION_ERROR");
    if (!isOptionalBool(b.online_booking))     throw new AppError(400, "online_booking must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.commission_enabled)) throw new AppError(400, "commission_enabled must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.resource_required))  throw new AppError(400, "resource_required must be a boolean", "VALIDATION_ERROR");
    if (!isEnum(b.available_for, ["all", "male", "female", "other"])) throw new AppError(400, "available_for must be: all | male | female | other", "VALIDATION_ERROR");
    validateUuidArray(b.service_ids, "service_ids");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateBundle = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalUUID(b.category_id))    throw new AppError(400, "category_id must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))  throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isEnum(b.schedule_type, ["sequence", "parallel"])) throw new AppError(400, "schedule_type must be: sequence | parallel", "VALIDATION_ERROR");
    if (!isEnum(b.price_type, ["service_pricing", "fixed", "free"])) throw new AppError(400, "price_type must be: service_pricing | fixed | free", "VALIDATION_ERROR");
    if (!isOptionalNonNeg(b.retail_price))     throw new AppError(400, "retail_price must be a non-negative number", "VALIDATION_ERROR");
    if (!isOptionalBool(b.online_booking))     throw new AppError(400, "online_booking must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.commission_enabled)) throw new AppError(400, "commission_enabled must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.resource_required))  throw new AppError(400, "resource_required must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.is_active))          throw new AppError(400, "is_active must be a boolean", "VALIDATION_ERROR");
    if (!isEnum(b.available_for, ["all", "male", "female", "other"])) throw new AppError(400, "available_for must be: all | male | female | other", "VALIDATION_ERROR");
    validateUuidArray(b.service_ids, "service_ids");
    return next();
  } catch (err) { return next(err); }
};