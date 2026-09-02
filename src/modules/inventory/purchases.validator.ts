import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isOptionalString = (v: unknown): boolean =>
    v === undefined || v === null || typeof v === "string";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isOptionalDate = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === "string" && DATE_RE.test(v));

// ─── Create Purchase validator ─────────────────────────────────────────────────
// A purchase is always a supplier + one or more product lines, saved in a
// single request — see purchases.repository.ts#create() for why (one POST,
// one transaction, no per-item round trips).
export const validateCreatePurchase = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (!isUUID(b.supplier_id)) {
            throw new AppError(400, "supplier_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalDate(b.purchase_date)) {
            throw new AppError(400, "purchase_date must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        if (!Array.isArray(b.items) || b.items.length === 0) {
            throw new AppError(400, "items must be a non-empty array", "VALIDATION_ERROR");
        }

        for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (!isUUID(item.product_id)) {
                throw new AppError(400, `items[${i}].product_id must be a UUID`, "VALIDATION_ERROR");
            }
            if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
                throw new AppError(400, `items[${i}].quantity must be a positive number`, "VALIDATION_ERROR");
            }
            if (typeof item.purchase_price !== "number" || !Number.isFinite(item.purchase_price) || item.purchase_price < 0) {
                throw new AppError(400, `items[${i}].purchase_price must be a non-negative number`, "VALIDATION_ERROR");
            }
            if (!isOptionalDate(item.expiry_date)) {
                throw new AppError(400, `items[${i}].expiry_date must be in YYYY-MM-DD format`, "VALIDATION_ERROR");
            }
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── List Purchases validator ──────────────────────────────────────────────────
// Matches every query param purchasesController.list actually reads (see
// ListPurchaseFilters) — was previously defined but never wired to the
// route, so none of these were checked at all.
export const validateListPurchases = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        if (!isOptionalString(req.query.search)) {
            throw new AppError(400, "search must be a string", "VALIDATION_ERROR");
        }
        if (req.query.supplier_id !== undefined && !isUUID(req.query.supplier_id)) {
            throw new AppError(400, "supplier_id must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalDate(req.query.date_from)) {
            throw new AppError(400, "date_from must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        if (!isOptionalDate(req.query.date_to)) {
            throw new AppError(400, "date_to must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};
