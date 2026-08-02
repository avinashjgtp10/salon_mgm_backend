import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { MeasureUnit, TaxType, ProductType } from "./products.types";

// ─── Primitive Helpers ────────────────────────────────────────────────────────

const isNonEmptyString = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;

// `null` is a legitimate value here, not just `undefined` — the edit form
// sends it deliberately to CLEAR a field (e.g. team_commission_rate when the
// toggle is switched off, or brand_id when "no brand" is selected), and
// products.repository.ts's update() sets whatever key is present verbatim
// (SET col = $1 with value null), which is exactly the intended "clear this
// column" behavior. Rejecting null here made every clear-a-field action fail
// as a validation error instead of doing what the UI promised.
const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";

const isOptionalNumber = (v: unknown) =>
    v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));

const isOptionalNonNeg = (v: unknown) =>
    v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

const isOptionalBoolean = (v: unknown) => v === undefined || v === null || typeof v === "boolean";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown) => v === undefined || v === null || isUUID(v);

const VALID_MEASURE_UNITS: MeasureUnit[] = ["ml", "l", "g", "kg", "pcs", "oz", "lb", "bottle", "tube", "pack", "box", "roll"];
const VALID_TAX_TYPES: TaxType[] = ["no_tax", "gst_5", "gst_12", "gst_18", "gst_28", "custom"];
const VALID_PRODUCT_TYPES: ProductType[] = ["retail", "consumable", "both"];

// ─── Coercion for FormData (Multipart) Requests ───────────────────────────────

const coerceProductFields = (b: Record<string, any>) => {
    if (!b || typeof b !== "object") return;
    const floatFields = ["amount", "qty_alert", "bottle_size", "supply_price", "retail_price", "markup_percentage", "custom_tax_rate", "team_commission_rate"];
    for (const f of floatFields) {
        if (typeof b[f] === "string" && b[f].trim() !== "") {
            const parsed = parseFloat(b[f]);
            if (!Number.isNaN(parsed)) b[f] = parsed;
        }
    }
    const boolFields = ["retail_sales_enabled", "team_commission_enabled"];
    for (const f of boolFields) {
        if (b[f] === "true" || b[f] === "1") b[f] = true;
        if (b[f] === "false" || b[f] === "0") b[f] = false;
    }
    // The frontend's product-type/unit UI sends `unit`, but the DB column
    // (and every other layer here) is `measure_unit` — alias it across, then
    // drop the frontend-only key so it doesn't leak into repository.update()'s
    // dynamic `SET <key> = $n` loop (there's no `unit` column to set).
    // `unit: null` means "leave measure_unit as-is" (e.g. switching a product
    // to Retail doesn't clear it — the column is NOT NULL with no "no unit"
    // state), not "clear the column", so skip aliasing in that case.
    if (b.unit !== undefined) {
        if (b.unit !== null && b.measure_unit === undefined) b.measure_unit = b.unit;
        delete b.unit;
    }
    if (typeof b.measure_unit === "string") b.measure_unit = b.measure_unit.toLowerCase();
    for (const key of Object.keys(b)) {
        if (b[key] === "" || b[key] === "undefined" || b[key] === "null") {
            b[key] = undefined;
        }
    }
};

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
    if (!isOptionalUUID(b.supplier_id)) {
        throw new AppError(400, "supplier_id must be a UUID", "VALIDATION_ERROR");
    }
    if (b.measure_unit !== undefined && !VALID_MEASURE_UNITS.includes(b.measure_unit as MeasureUnit)) {
        throw new AppError(400, `measure_unit must be one of: ${VALID_MEASURE_UNITS.join(", ")}`, "VALIDATION_ERROR");
    }
    if (b.product_type !== undefined && !VALID_PRODUCT_TYPES.includes(b.product_type as ProductType)) {
        throw new AppError(400, `product_type must be one of: ${VALID_PRODUCT_TYPES.join(", ")}`, "VALIDATION_ERROR");
    }
    if (!isOptionalString(b.size)) {
        throw new AppError(400, "size must be a string", "VALIDATION_ERROR");
    }
    if (typeof b.size === "string" && b.size.length > 30) {
        throw new AppError(400, "size must be at most 30 characters", "VALIDATION_ERROR");
    }
    if (!isOptionalNonNeg(b.amount)) {
        throw new AppError(400, "amount must be a non-negative number", "VALIDATION_ERROR");
    }
    if (!isOptionalNonNeg(b.qty_alert)) {
        throw new AppError(400, "qty_alert must be a non-negative number", "VALIDATION_ERROR");
    }
    // Bottle/container capacity for consumable stock tracking. Absent/null is
    // valid (opts the product out of container-based tracking); zero is not,
    // since stock quantity is derived as amount / bottle_size elsewhere.
    if (b.bottle_size !== undefined && b.bottle_size !== null) {
        if (!(typeof b.bottle_size === "number" && Number.isFinite(b.bottle_size) && b.bottle_size > 0)) {
            throw new AppError(400, "bottle_size must be a positive number", "VALIDATION_ERROR");
        }
        // 'both'-type products can also be sold as a retail line item on an
        // appointment (appointments.service.ts → productsRepository.deductStock),
        // which decrements `amount` by a raw unit count, not by volume — mixing
        // that with bottle-based volume tracking on the same `amount` column
        // would silently corrupt the remaining-volume figure. Only a pure
        // 'consumable' product (never sold as a standalone retail line item)
        // is safe to opt into container tracking. Update-time patches that
        // omit product_type are checked against the existing row in
        // productsService.update, since the validator has no DB access here.
        const effectiveType = b.product_type !== undefined ? b.product_type : (requireName ? "retail" : undefined);
        if (effectiveType !== undefined && effectiveType !== "consumable") {
            throw new AppError(400, "bottle_size (container tracking) is only supported for product_type 'consumable'", "VALIDATION_ERROR");
        }
    }
    // Both fields are always sent together by the Create/Edit Product forms
    // (a full-form submit, not a sparse patch) — safe to cross-validate here
    // without needing the existing DB row for whichever field is "missing".
    if (typeof b.amount === "number" && typeof b.qty_alert === "number" && b.qty_alert >= b.amount) {
        throw new AppError(400, "Low Stock Alert Quantity must be less than the Product Quantity.", "VALIDATION_ERROR");
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
    if (!isOptionalNonNeg(b.supply_price)) {
        throw new AppError(400, "supply_price must be a non-negative number", "VALIDATION_ERROR");
    }
    if (!isOptionalBoolean(b.retail_sales_enabled)) {
        throw new AppError(400, "retail_sales_enabled must be a boolean", "VALIDATION_ERROR");
    }
    if (!isOptionalNonNeg(b.retail_price)) {
        throw new AppError(400, "retail_price must be a non-negative number", "VALIDATION_ERROR");
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
    if (!isOptionalString(b.hsn_sac)) {
        throw new AppError(400, "hsn_sac must be a string", "VALIDATION_ERROR");
    }
    if (typeof b.hsn_sac === "string" && b.hsn_sac.length > 20) {
        throw new AppError(400, "hsn_sac must be at most 20 characters", "VALIDATION_ERROR");
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
        coerceProductFields(req.body);
        validateProductFields(req.body, true);
        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateProduct = (req: Request, _res: Response, next: NextFunction) => {
    try {
        coerceProductFields(req.body);
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

// ─── List Query Validator ─────────────────────────────────────────────────────

export const validateListQuery = (req: Request, _res: Response, next: NextFunction) => {
    const MAX_PAGE_SIZE = 100;
    const { page, pageSize, limit } = req.query;

    if (page !== undefined) {
        const n = parseInt(String(page), 10);
        if (!Number.isInteger(n) || n < 1) {
            return next(new AppError(400, "page must be a positive integer", "VALIDATION_ERROR"));
        }
    }
    const sizeParam = pageSize ?? limit;
    if (sizeParam !== undefined) {
        const n = parseInt(String(sizeParam), 10);
        if (!Number.isInteger(n) || n < 1) {
            return next(new AppError(400, "pageSize must be a positive integer", "VALIDATION_ERROR"));
        }
        if (n > MAX_PAGE_SIZE) {
            return next(new AppError(400, `pageSize must not exceed ${MAX_PAGE_SIZE}`, "VALIDATION_ERROR"));
        }
    }
    return next();
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
