import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { MeasureUnit, TaxType } from "./products.types";

// ─── Primitive Helpers ────────────────────────────────────────────────────────

const isNonEmptyString = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;

const isOptionalString = (v: unknown) => v === undefined || typeof v === "string";

const isOptionalNumber = (v: unknown) =>
    v === undefined || (typeof v === "number" && Number.isFinite(v));

const isOptionalBoolean = (v: unknown) => v === undefined || typeof v === "boolean";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown) => v === undefined || isUUID(v);

const VALID_MEASURE_UNITS: MeasureUnit[] = ["ml", "l", "g", "kg", "pcs", "oz", "lb"];
const VALID_TAX_TYPES: TaxType[] = ["no_tax", "gst_5", "gst_12", "gst_18", "gst_28", "custom"];

// ─── Shared Product Field Validation ─────────────────────────────────────────

const validateProductFields = (b: Record<string, unknown>, requireName = false) => {
    if (requireName) {
        if (!isNonEmptyString(b.name)) {
            throw new AppError(400, "name is required and must be a non-empty string", "VALIDATION_ERROR");
        }
    } else {
        if (b.name !== undefined && !isNonEmptyString(b.name)) {
            throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
        }
    }

    if (!isOptionalString(b.barcode)) {
        throw new AppError(400, "barcode must be a string", "VALIDATION_ERROR");
    }
    if (!isOptionalUUID(b.brand_id)) {
        throw new AppError(400, "brand_id must be a UUID", "VALIDATION_ERROR");
    }
    if (!isOptionalUUID(b.category_id)) {
        throw new AppError(400, "category_id must be a UUID", "VALIDATION_ERROR");
    }
    if (b.measure_unit !== undefined && !VALID_MEASURE_UNITS.includes(b.measure_unit as MeasureUnit)) {
        throw new AppError(400, `measure_unit must be one of: ${VALID_MEASURE_UNITS.join(", ")}`, "VALIDATION_ERROR");
    }
    if (!isOptionalNumber(b.amount)) {
        throw new AppError(400, "amount must be a number", "VALIDATION_ERROR");
    }
    if (!isOptionalString(b.short_description)) {
        throw new AppError(400, "short_description must be a string", "VALIDATION_ERROR");
    }
    if (typeof b.short_description === "string" && b.short_description.length > 100) {
        throw new AppError(400, "short_description must be at most 100 characters", "VALIDATION_ERROR");
    }
    if (!isOptionalString(b.description)) {
        throw new AppError(400, "description must be a string", "VALIDATION_ERROR");
    }
    if (typeof b.description === "string" && b.description.length > 1000) {
        throw new AppError(400, "description must be at most 1000 characters", "VALIDATION_ERROR");
    }
    if (!isOptionalNumber(b.supply_price)) {
        throw new AppError(400, "supply_price must be a number", "VALIDATION_ERROR");
    }
    if (!isOptionalBoolean(b.retail_sales_enabled)) {
        throw new AppError(400, "retail_sales_enabled must be a boolean", "VALIDATION_ERROR");
    }
    if (!isOptionalNumber(b.retail_price)) {
        throw new AppError(400, "retail_price must be a number", "VALIDATION_ERROR");
    }
    if (!isOptionalNumber(b.markup_percentage)) {
        throw new AppError(400, "markup_percentage must be a number", "VALIDATION_ERROR");
    }
    if (b.tax_type !== undefined && !VALID_TAX_TYPES.includes(b.tax_type as TaxType)) {
        throw new AppError(400, `tax_type must be one of: ${VALID_TAX_TYPES.join(", ")}`, "VALIDATION_ERROR");
    }
    if (!isOptionalNumber(b.custom_tax_rate)) {
        throw new AppError(400, "custom_tax_rate must be a number", "VALIDATION_ERROR");
    }
    if (!isOptionalBoolean(b.team_commission_enabled)) {
        throw new AppError(400, "team_commission_enabled must be a boolean", "VALIDATION_ERROR");
    }
    if (!isOptionalNumber(b.team_commission_rate)) {
        throw new AppError(400, "team_commission_rate must be a number", "VALIDATION_ERROR");
    }
};

// ─── Product Validators ───────────────────────────────────────────────────────

export const validateCreateProduct = (req: Request, _res: Response, next: NextFunction) => {
    try {
        validateProductFields(req.body, true);
        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateProduct = (req: Request, _res: Response, next: NextFunction) => {
    try {
        validateProductFields(req.body, false);
        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateReorderPhotos = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const { photo_ids } = req.body;
        if (!Array.isArray(photo_ids) || photo_ids.length === 0 || !photo_ids.every((x) => isUUID(x))) {
            throw new AppError(400, "photo_ids must be a non-empty array of UUID strings", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── Brand Validators ─────────────────────────────────────────────────────────

export const validateCreateBrand = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.name)) {
            throw new AppError(400, "name is required and must be a non-empty string", "VALIDATION_ERROR");
        }
        if (b.name.length > 100) {
            throw new AppError(400, "name must be at most 100 characters", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateBrand = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (b.name !== undefined) {
            if (!isNonEmptyString(b.name)) {
                throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
            }
            if (b.name.length > 100) {
                throw new AppError(400, "name must be at most 100 characters", "VALIDATION_ERROR");
            }
        }
        return next();
    } catch (err) {
        return next(err);
    }
};
