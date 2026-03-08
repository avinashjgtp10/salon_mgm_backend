import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { MovementType } from "./inventory.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown): boolean => v === undefined || v === null || isUUID(v);
const isOptionalString = (v: unknown): boolean =>
    v === undefined || v === null || typeof v === "string";
const isOptionalBoolean = (v: unknown): boolean =>
    v === undefined || v === null || typeof v === "boolean";
const isPositiveInt = (v: unknown): boolean =>
    typeof v === "number" && Number.isInteger(v) && v > 0;
const isOptionalPositiveNumber = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

const VALID_MOVEMENT_TYPES: MovementType[] = ["in", "out", "adjustment", "transfer"];

// ─── Supplier validators ──────────────────────────────────────────────────────

export const validateCreateSupplier = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (typeof b.name !== "string" || b.name.trim().length === 0) {
            throw new AppError(400, "name is required and must be a non-empty string", "VALIDATION_ERROR");
        }

        const optionalStrings = [
            "description", "first_name", "last_name",
            "mobile_country_code", "mobile_number",
            "telephone_country_code", "telephone_number",
            "email", "website",
            "street", "suburb", "city", "state", "zip_code", "country",
            "postal_street", "postal_suburb", "postal_city",
            "postal_state", "postal_zip_code", "postal_country",
        ];

        for (const f of optionalStrings) {
            if (!isOptionalString(b[f])) {
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }

        if (!isOptionalBoolean(b.same_as_physical)) {
            throw new AppError(400, "same_as_physical must be a boolean", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

export const validateUpdateSupplier = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (b.name !== undefined && (typeof b.name !== "string" || b.name.trim().length === 0)) {
            throw new AppError(400, "name must be a non-empty string", "VALIDATION_ERROR");
        }

        const optionalStrings = [
            "description", "first_name", "last_name",
            "mobile_country_code", "mobile_number",
            "telephone_country_code", "telephone_number",
            "email", "website",
            "street", "suburb", "city", "state", "zip_code", "country",
            "postal_street", "postal_suburb", "postal_city",
            "postal_state", "postal_zip_code", "postal_country",
        ];

        for (const f of optionalStrings) {
            if (!isOptionalString(b[f])) {
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
            }
        }

        if (!isOptionalBoolean(b.same_as_physical)) {
            throw new AppError(400, "same_as_physical must be a boolean", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── Stock Movement validator ─────────────────────────────────────────────────

export const validateCreateStockMovement = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (!isUUID(b.branch_id)) {
            throw new AppError(400, "branch_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!isUUID(b.product_id)) {
            throw new AppError(400, "product_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalUUID(b.supplier_id)) {
            throw new AppError(400, "supplier_id must be a UUID", "VALIDATION_ERROR");
        }
        if (!VALID_MOVEMENT_TYPES.includes(b.movement_type)) {
            throw new AppError(
                400,
                `movement_type must be one of: ${VALID_MOVEMENT_TYPES.join(", ")}`,
                "VALIDATION_ERROR"
            );
        }
        if (!isPositiveInt(b.quantity)) {
            throw new AppError(400, "quantity is required and must be a positive integer", "VALIDATION_ERROR");
        }
        if (!isOptionalPositiveNumber(b.unit_price)) {
            throw new AppError(400, "unit_price must be a non-negative number", "VALIDATION_ERROR");
        }
        if (!isOptionalPositiveNumber(b.total_amount)) {
            throw new AppError(400, "total_amount must be a non-negative number", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.notes)) {
            throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── Stock Take validator ─────────────────────────────────────────────────────

export const validateStockTake = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (!isUUID(b.branch_id)) {
            throw new AppError(400, "branch_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.notes)) {
            throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        }
        if (!Array.isArray(b.items) || b.items.length === 0) {
            throw new AppError(400, "items must be a non-empty array", "VALIDATION_ERROR");
        }

        for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (!isUUID(item.product_id)) {
                throw new AppError(400, `items[${i}].product_id must be a UUID`, "VALIDATION_ERROR");
            }
            if (
                typeof item.actual_qty !== "number" ||
                !Number.isInteger(item.actual_qty) ||
                item.actual_qty < 0
            ) {
                throw new AppError(
                    400,
                    `items[${i}].actual_qty must be a non-negative integer`,
                    "VALIDATION_ERROR"
                );
            }
            if (!isOptionalString(item.notes)) {
                throw new AppError(400, `items[${i}].notes must be a string`, "VALIDATION_ERROR");
            }
        }

        return next();
    } catch (err) {
        return next(err);
    }
};
