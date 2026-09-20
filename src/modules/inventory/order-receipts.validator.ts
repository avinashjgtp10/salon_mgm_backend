import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown): boolean => v === undefined || v === null || isUUID(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isOptionalDate = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === "string" && DATE_RE.test(v));

export const validateSaveReceiptDraft = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!isOptionalUUID(b.branch_id)) {
            throw new AppError(400, "branch_id must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalUUID(b.received_by)) {
            throw new AppError(400, "received_by must be a UUID", "VALIDATION_ERROR");
        }
        if (b.items !== undefined) {
            if (!Array.isArray(b.items)) {
                throw new AppError(400, "items must be an array", "VALIDATION_ERROR");
            }
            for (let i = 0; i < b.items.length; i++) {
                const item = b.items[i] ?? {};
                if (!isUUID(item.order_item_id)) {
                    throw new AppError(400, `items[${i}].order_item_id must be a UUID`, "VALIDATION_ERROR");
                }
                if (typeof item.confirmed_qty !== "number" || !Number.isFinite(item.confirmed_qty) || item.confirmed_qty < 0) {
                    throw new AppError(400, `items[${i}].confirmed_qty must be a non-negative number`, "VALIDATION_ERROR");
                }
                if (typeof item.damaged_qty !== "number" || !Number.isFinite(item.damaged_qty) || item.damaged_qty < 0) {
                    throw new AppError(400, `items[${i}].damaged_qty must be a non-negative number`, "VALIDATION_ERROR");
                }
            }
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateConfirmReceipt = (
    req: Request, _res: Response, next: NextFunction,
): void => {
    try {
        const b = req.body;
        if (!isOptionalDate(b.purchase_date)) {
            throw new AppError(400, "purchase_date must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
