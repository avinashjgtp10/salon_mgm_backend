import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { STOCK_LEDGER_TRANSACTION_TYPES } from "./stock-ledger.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isOptionalString = (v: unknown): boolean =>
    v === undefined || v === null || typeof v === "string";
const isPositiveNumber = (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
const isOptionalPositiveNumber = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

export const validateCreateStockLedgerEntry = (req: Request, _res: Response, next: NextFunction): void => {
    try {
        const b = req.body;
        if (!isUUID(b.branch_id)) throw new AppError(400, "branch_id is required and must be a UUID", "VALIDATION_ERROR");
        if (!isUUID(b.product_id)) throw new AppError(400, "product_id is required and must be a UUID", "VALIDATION_ERROR");
        if (!STOCK_LEDGER_TRANSACTION_TYPES.includes(b.transaction_type)) {
            throw new AppError(400, `transaction_type must be one of: ${STOCK_LEDGER_TRANSACTION_TYPES.join(", ")}`, "VALIDATION_ERROR");
        }
        if (!isPositiveNumber(b.quantity)) throw new AppError(400, "quantity is required and must be greater than 0", "VALIDATION_ERROR");
        if (!isOptionalString(b.reference)) throw new AppError(400, "reference must be a string", "VALIDATION_ERROR");
        if (!isOptionalPositiveNumber(b.unit_cost)) throw new AppError(400, "unit_cost must be a non-negative number", "VALIDATION_ERROR");
        if (!isOptionalString(b.reason)) throw new AppError(400, "reason must be a string", "VALIDATION_ERROR");
        if (!isOptionalString(b.notes)) throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        next();
    } catch (err) { next(err); }
};

export const validateUpdateStockLedgerEntry = (req: Request, _res: Response, next: NextFunction): void => {
    try {
        const b = req.body;
        if (!isOptionalString(b.reference)) throw new AppError(400, "reference must be a string", "VALIDATION_ERROR");
        if (!isOptionalString(b.reason)) throw new AppError(400, "reason must be a string", "VALIDATION_ERROR");
        if (!isOptionalString(b.notes)) throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        next();
    } catch (err) { next(err); }
};
