import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const isNonEmptyString      = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptionalString      = (v: unknown) => v === undefined || typeof v === "string";
const isOptionalBool        = (v: unknown) => v === undefined || typeof v === "boolean";
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

const validateConsumablesUsed = (v: unknown, field: string): void => {
  if (v === undefined) return;
  if (!Array.isArray(v)) throw new AppError(400, `${field} must be an array`, "VALIDATION_ERROR");
  for (const item of v as unknown[]) {
    if (!item || typeof item !== "object")
      throw new AppError(400, `${field} items must be objects`, "VALIDATION_ERROR");
    const rec = item as Record<string, unknown>;
    if (!isUUID(rec.product_id))
      throw new AppError(400, `${field} items must have a valid product_id`, "VALIDATION_ERROR");
    if (typeof rec.qty !== "number" || !Number.isFinite(rec.qty) || rec.qty < 0)
      throw new AppError(400, `${field} items must have a non-negative qty`, "VALIDATION_ERROR");
    if (rec.unit !== undefined && typeof rec.unit !== "string")
      throw new AppError(400, `${field} items' unit must be a string`, "VALIDATION_ERROR");
  }
};

// ─── Services ─────────────────────────────────────────────────────────────────

// Everything the create/update endpoints can actually persist — the same set
// the repository's INSERT and its update ALLOWLIST cover, plus the two
// join-table inputs.
//
// The API used to accept any key and return 201, so a field the frontend sent
// but the DB had no column for vanished with no error. That is how
// consumables_used went unpersisted until a migration caught up, and how
// discounted_price / padding_before / padding_after / gender_preference /
// image_url survived for so long. Warning here means the next one surfaces
// immediately instead of months later. Deliberately a warning, not a 400: an
// older client sending a stale field should not have its save rejected.
const KNOWN_SERVICE_KEYS = new Set([
  "name", "category_id", "treatment_type", "description",
  "price_type", "price", "duration", "is_active",
  "online_booking", "commission_enabled", "resource_required",
  "staff_ids", "consumables_used",
]);

function warnUnknownKeys(body: Record<string, unknown>, route: string): void {
  const unknown = Object.keys(body ?? {}).filter((k) => !KNOWN_SERVICE_KEYS.has(k));
  if (unknown.length > 0) {
    console.warn(
      `[services] ${route}: ignoring unknown field(s) that no column exists for: ${unknown.join(", ")}`,
    );
  }
}

export const validateCreateService = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    warnUnknownKeys(b, "POST /services");
    if (!isNonEmptyString(b.name))           throw new AppError(400, "name is required", "VALIDATION_ERROR");
    if (!isUUID(b.category_id))              throw new AppError(400, "category_id is required and must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalString(b.treatment_type)) throw new AppError(400, "treatment_type must be a string", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))    throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isEnum(b.price_type, ["fixed", "from", "free"])) throw new AppError(400, "price_type must be: fixed | from | free", "VALIDATION_ERROR");
    if (!isOptionalNonNeg(b.price))          throw new AppError(400, "price must be a non-negative number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.duration))          throw new AppError(400, "duration must be an integer (minutes)", "VALIDATION_ERROR");
    if (!isOptionalBool(b.online_booking))   throw new AppError(400, "online_booking must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.commission_enabled)) throw new AppError(400, "commission_enabled must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.resource_required))  throw new AppError(400, "resource_required must be a boolean", "VALIDATION_ERROR");
    validateUuidArray(b.staff_ids, "staff_ids");
    validateConsumablesUsed(b.consumables_used, "consumables_used");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateService = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    warnUnknownKeys(b, "PATCH /services/:id");
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalUUID(b.category_id))      throw new AppError(400, "category_id must be a UUID", "VALIDATION_ERROR");
    if (!isOptionalString(b.treatment_type)) throw new AppError(400, "treatment_type must be a string", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))    throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isEnum(b.price_type, ["fixed", "from", "free"])) throw new AppError(400, "price_type must be: fixed | from | free", "VALIDATION_ERROR");
    if (!isOptionalNonNeg(b.price))          throw new AppError(400, "price must be a non-negative number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.duration))          throw new AppError(400, "duration must be an integer", "VALIDATION_ERROR");
    if (!isOptionalBool(b.online_booking))   throw new AppError(400, "online_booking must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.commission_enabled)) throw new AppError(400, "commission_enabled must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.resource_required))  throw new AppError(400, "resource_required must be a boolean", "VALIDATION_ERROR");
    if (!isOptionalBool(b.is_active))        throw new AppError(400, "is_active must be a boolean", "VALIDATION_ERROR");
    validateUuidArray(b.staff_ids, "staff_ids");
    validateConsumablesUsed(b.consumables_used, "consumables_used");
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
    if (!isOptionalNonNeg(b.additional_price)) throw new AppError(400, "additional_price must be a non-negative number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.additional_duration)) throw new AppError(400, "additional_duration must be an integer", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateAddOnOption = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalString(b.description))      throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    if (!isOptionalNonNeg(b.additional_price)) throw new AppError(400, "additional_price must be a non-negative number", "VALIDATION_ERROR");
    if (!isOptionalInt(b.additional_duration)) throw new AppError(400, "additional_duration must be an integer", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

export const validateCreateConsultationForm = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (!isNonEmptyString(b.name)) throw new AppError(400, "name is required", "VALIDATION_ERROR");
    return next();
  } catch (err) { return next(err); }
};

export const validateUpdateConsultationForm = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const b = req.body;
    if (b.name !== undefined && !isNonEmptyString(b.name)) throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
    if (!isOptionalBool(b.is_selected)) throw new AppError(400, "is_selected must be a boolean", "VALIDATION_ERROR");
    if (b.values !== undefined && b.values !== null && (typeof b.values !== "object" || Array.isArray(b.values)))
      throw new AppError(400, "values must be an object", "VALIDATION_ERROR");
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