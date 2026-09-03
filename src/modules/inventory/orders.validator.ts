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

// ─── Create Order validator ────────────────────────────────────────────────────
// An order is always a supplier + one or more product lines, saved in a
// single request — mirrors validateCreatePurchase's shape (see
// purchases.validator.ts), extended with the PO-specific header fields.
export const validateCreateOrder = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (!isUUID(b.supplier_id)) {
            throw new AppError(400, "supplier_id is required and must be a UUID", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.delivery_address)) {
            throw new AppError(400, "delivery_address must be a string", "VALIDATION_ERROR");
        }
        if (!isOptionalString(b.delivery_instructions)) {
            throw new AppError(400, "delivery_instructions must be a string", "VALIDATION_ERROR");
        }
        if (!isOptionalDate(b.order_date)) {
            throw new AppError(400, "order_date must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        if (!isOptionalDate(b.shipment_date)) {
            throw new AppError(400, "shipment_date must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        if (!isOptionalDate(b.delivery_date)) {
            throw new AppError(400, "delivery_date must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        if (b.payment_terms_days !== undefined && b.payment_terms_days !== null) {
            if (typeof b.payment_terms_days !== "number" || !Number.isFinite(b.payment_terms_days) || b.payment_terms_days < 0) {
                throw new AppError(400, "payment_terms_days must be a non-negative number", "VALIDATION_ERROR");
            }
        }
        if (b.tax_type !== "inclusive" && b.tax_type !== "exclusive") {
            throw new AppError(400, "tax_type must be 'inclusive' or 'exclusive'", "VALIDATION_ERROR");
        }
        if (b.tax_rate !== undefined && b.tax_rate !== null) {
            if (typeof b.tax_rate !== "number" || !Number.isFinite(b.tax_rate) || b.tax_rate < 0) {
                throw new AppError(400, "tax_rate must be a non-negative number", "VALIDATION_ERROR");
            }
        }
        if (b.shipping_cost !== undefined && b.shipping_cost !== null) {
            if (typeof b.shipping_cost !== "number" || !Number.isFinite(b.shipping_cost) || b.shipping_cost < 0) {
                throw new AppError(400, "shipping_cost must be a non-negative number", "VALIDATION_ERROR");
            }
        }
        if (!isOptionalString(b.remark) || !isOptionalString(b.ref_number)
            || !isOptionalString(b.tax_group) || !isOptionalString(b.terms_conditions)
            || !isOptionalString(b.signature_url)) {
            throw new AppError(400, "remark/ref_number/tax_group/terms_conditions/signature_url must be strings", "VALIDATION_ERROR");
        }
        if (!Array.isArray(b.items) || b.items.length === 0) {
            throw new AppError(400, "items must be a non-empty array", "VALIDATION_ERROR");
        }

        for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (!isUUID(item.product_id)) {
                throw new AppError(400, `items[${i}].product_id must be a UUID`, "VALIDATION_ERROR");
            }
            if (typeof item.qty !== "number" || !Number.isFinite(item.qty) || item.qty <= 0) {
                throw new AppError(400, `items[${i}].qty must be a positive number`, "VALIDATION_ERROR");
            }
            if (typeof item.selling_price !== "number" || !Number.isFinite(item.selling_price) || item.selling_price < 0) {
                throw new AppError(400, `items[${i}].selling_price must be a non-negative number`, "VALIDATION_ERROR");
            }
            if (typeof item.cost_price !== "number" || !Number.isFinite(item.cost_price) || item.cost_price < 0) {
                throw new AppError(400, `items[${i}].cost_price must be a non-negative number`, "VALIDATION_ERROR");
            }
            if (item.discount_percent !== undefined && item.discount_percent !== null) {
                if (typeof item.discount_percent !== "number" || !Number.isFinite(item.discount_percent)
                    || item.discount_percent < 0 || item.discount_percent > 100) {
                    throw new AppError(400, `items[${i}].discount_percent must be between 0 and 100`, "VALIDATION_ERROR");
                }
            }
            if (!isOptionalString(item.product_code)) {
                throw new AppError(400, `items[${i}].product_code must be a string`, "VALIDATION_ERROR");
            }
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── Receive Order validator ────────────────────────────────────────────────────
export const validateReceiveOrder = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;

        if (!isOptionalDate(b.purchase_date)) {
            throw new AppError(400, "purchase_date must be in YYYY-MM-DD format", "VALIDATION_ERROR");
        }
        if (!Array.isArray(b.items) || b.items.length === 0) {
            throw new AppError(400, "items must be a non-empty array", "VALIDATION_ERROR");
        }
        for (let i = 0; i < b.items.length; i++) {
            const item = b.items[i];
            if (!isUUID(item.order_item_id)) {
                throw new AppError(400, `items[${i}].order_item_id must be a UUID`, "VALIDATION_ERROR");
            }
            if (typeof item.received_qty !== "number" || !Number.isFinite(item.received_qty) || item.received_qty < 0) {
                throw new AppError(400, `items[${i}].received_qty must be a non-negative number`, "VALIDATION_ERROR");
            }
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── Correct Received Qty validator ────────────────────────────────────────────
export const validateCorrectReceivedQty = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const b = req.body;
        if (typeof b.received_qty !== "number" || !Number.isFinite(b.received_qty) || b.received_qty < 0) {
            throw new AppError(400, "received_qty must be a non-negative number", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── List Orders validator ─────────────────────────────────────────────────────
export const validateListOrders = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        if (!isOptionalString(req.query.search)) {
            throw new AppError(400, "search must be a string", "VALIDATION_ERROR");
        }
        const status = req.query.status;
        if (status !== undefined && !["draft", "sent", "partially_received", "received", "cancelled"].includes(String(status))) {
            throw new AppError(400, "status must be one of draft, sent, partially_received, received, cancelled", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) {
        return next(err);
    }
};
