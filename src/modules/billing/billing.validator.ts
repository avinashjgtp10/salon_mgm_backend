import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { BillingPaymentMethod } from "./billing.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUUID = (v: unknown): boolean => typeof v === "string" && UUID_RE.test(v);
const isPositiveInt = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v > 0;
const isOptionalStr = (v: unknown): boolean => v === undefined || v === null || typeof v === "string";

const VALID_PAYMENT_METHODS: BillingPaymentMethod[] = ["card", "upi", "bank_transfer", "cash"];

const OPTIONAL_STR_FIELDS = [
    "card_holder_name",
    "card_last4",
    "card_brand",
    "card_expiry",
    "account_type",
    "billing_first_name",
    "billing_last_name",
    "billing_address",
    "vat_number",
] as const;

// ─── Subscribe (Enable button on the form) ────────────────────────────────────

export const validateSubscribeBilling = (
    req: Request, _res: Response, next: NextFunction
): void => {
    try {
        const b = req.body;

        if (!isUUID(b.salon_id))
            throw new AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");

        if (!isUUID(b.plan_id))
            throw new AppError(400, "plan_id is required and must be a UUID", "VALIDATION_ERROR");

        if (!isPositiveInt(b.quantity))
            throw new AppError(400, "quantity is required and must be a positive integer", "VALIDATION_ERROR");

        if (b.payment_method !== undefined && !VALID_PAYMENT_METHODS.includes(b.payment_method))
            throw new AppError(400, `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`, "VALIDATION_ERROR");

        // card_expiry format MM/YY
        if (b.card_expiry !== undefined && !/^\d{2}\/\d{2}$/.test(b.card_expiry))
            throw new AppError(400, "card_expiry must be in MM/YY format", "VALIDATION_ERROR");

        // card_last4 — exactly 4 digits
        if (b.card_last4 !== undefined && !/^\d{4}$/.test(b.card_last4))
            throw new AppError(400, "card_last4 must be exactly 4 digits", "VALIDATION_ERROR");

        // vat_number max 18 chars
        if (b.vat_number !== undefined && typeof b.vat_number === "string" && b.vat_number.length > 18)
            throw new AppError(400, "vat_number must not exceed 18 characters", "VALIDATION_ERROR");

        for (const f of OPTIONAL_STR_FIELDS) {
            if (!isOptionalStr(b[f]))
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};

// ─── Update (change card / billing details) ───────────────────────────────────

export const validateUpdateBillingSubscription = (
    req: Request, _res: Response, next: NextFunction
): void => {
    try {
        const b = req.body;

        if (b.quantity !== undefined && !isPositiveInt(b.quantity))
            throw new AppError(400, "quantity must be a positive integer", "VALIDATION_ERROR");

        if (b.payment_method !== undefined && !VALID_PAYMENT_METHODS.includes(b.payment_method))
            throw new AppError(400, `payment_method must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`, "VALIDATION_ERROR");

        if (b.card_expiry !== undefined && !/^\d{2}\/\d{2}$/.test(b.card_expiry))
            throw new AppError(400, "card_expiry must be in MM/YY format", "VALIDATION_ERROR");

        if (b.card_last4 !== undefined && !/^\d{4}$/.test(b.card_last4))
            throw new AppError(400, "card_last4 must be exactly 4 digits", "VALIDATION_ERROR");

        if (b.vat_number !== undefined && typeof b.vat_number === "string" && b.vat_number.length > 18)
            throw new AppError(400, "vat_number must not exceed 18 characters", "VALIDATION_ERROR");

        for (const f of OPTIONAL_STR_FIELDS) {
            if (!isOptionalStr(b[f]))
                throw new AppError(400, `${f} must be a string`, "VALIDATION_ERROR");
        }

        return next();
    } catch (err) {
        return next(err);
    }
};
