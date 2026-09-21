import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isOptionalString = (v: unknown): boolean => v === undefined || v === null || typeof v === "string";
const isOptionalNumber = (v: unknown): boolean => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));
const isOptionalBoolean = (v: unknown): boolean => v === undefined || v === null || typeof v === "boolean";

export const validateAddProductSupplier = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!isUUID(b.supplier_id)) {
            throw new AppError(400, "supplier_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.supplier_sku)) {
            throw new AppError(400, "supplier_sku must be a string", "VALIDATION_ERROR");
        }
        if (!isOptionalNumber(b.price) || (typeof b.price === "number" && b.price < 0)) {
            throw new AppError(400, "price must be a non-negative number", "VALIDATION_ERROR");
        }
        if (!isOptionalBoolean(b.is_preferred)) {
            throw new AppError(400, "is_preferred must be a boolean", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateUpdateProductSupplier = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!isOptionalString(b.supplier_sku)) {
            throw new AppError(400, "supplier_sku must be a string", "VALIDATION_ERROR");
        }
        if (!isOptionalNumber(b.price) || (typeof b.price === "number" && b.price < 0)) {
            throw new AppError(400, "price must be a non-negative number", "VALIDATION_ERROR");
        }
        if (!isOptionalBoolean(b.is_preferred)) {
            throw new AppError(400, "is_preferred must be a boolean", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
