import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown): boolean => v === undefined || v === null || isUUID(v);
const isOptionalString = (v: unknown): boolean =>
    v === undefined || v === null || typeof v === "string";

export const validateCreateProductAudit = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!isUUID(b.branch_id)) {
            throw new AppError(400, "branch_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (typeof b.name !== "string" || b.name.trim().length === 0) {
            throw new AppError(400, "name is required and must be a non-empty string", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.notes)) {
            throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        }
        if (!isOptionalUUID(b.auditor_id)) {
            throw new AppError(400, "auditor_id must be a UUID", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateAddAuditItems = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!Array.isArray(b.product_ids) || b.product_ids.length === 0) {
            throw new AppError(400, "product_ids must be a non-empty array", "VALIDATION_ERROR");
        }
        for (let i = 0; i < b.product_ids.length; i++) {
            if (!isUUID(b.product_ids[i])) {
                throw new AppError(400, `product_ids[${i}] must be a UUID`, "VALIDATION_ERROR");
            }
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateUpdateAuditItem = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (b.physical_qty !== null && b.physical_qty !== undefined && typeof b.physical_qty !== "number") {
            throw new AppError(400, "physical_qty must be a number or null", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.reason)) {
            throw new AppError(400, "reason must be a string", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateRejectAudit = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (typeof b.reason !== "string" || b.reason.trim().length === 0) {
            throw new AppError(400, "reason is required and must be a non-empty string", "VALIDATION_ERROR");
        }
        if (!isOptionalUUID(b.reviewer_id)) {
            throw new AppError(400, "reviewer_id must be a UUID", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateApproveAudit = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!isOptionalUUID(b.reviewer_id)) {
            throw new AppError(400, "reviewer_id must be a UUID", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
