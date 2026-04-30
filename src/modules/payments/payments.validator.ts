import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { PaymentStatus } from "./payments.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
const isOptionalUUID = (v: unknown) => v === undefined || v === null || isUUID(v);
const isOptionalString = (v: unknown) => v === undefined || v === null || typeof v === "string";

const VALID_STATUSES: PaymentStatus[] = ["pending", "partial", "completed", "failed", "refunded"];

export const validateCreatePayment = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!isUUID(b.salon_id))
            throw new AppError(400, "salon_id is required and must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.appointment_id))
            throw new AppError(400, "appointment_id must be a UUID", "VALIDATION_ERROR");
        if (!isOptionalUUID(b.client_id))
            throw new AppError(400, "client_id must be a UUID", "VALIDATION_ERROR");
        if (typeof b.gross_amount !== "number" || b.gross_amount < 0)
            throw new AppError(400, "gross_amount is required and must be a non-negative number", "VALIDATION_ERROR");
        if (typeof b.net_amount !== "number" || b.net_amount < 0)
            throw new AppError(400, "net_amount is required and must be a non-negative number", "VALIDATION_ERROR");
        if (b.discount_amount !== undefined && (typeof b.discount_amount !== "number" || b.discount_amount < 0))
            throw new AppError(400, "discount_amount must be a non-negative number", "VALIDATION_ERROR");
        if (b.ewallet_used !== undefined && (typeof b.ewallet_used !== "number" || b.ewallet_used < 0))
            throw new AppError(400, "ewallet_used must be a non-negative number", "VALIDATION_ERROR");
        if (typeof b.payment_method !== "string" || b.payment_method.trim().length === 0)
            throw new AppError(400, "payment_method is required", "VALIDATION_ERROR");
        if (!isOptionalString(b.coupon_code))
            throw new AppError(400, "coupon_code must be a string", "VALIDATION_ERROR");
        if (b.status !== undefined && !VALID_STATUSES.includes(b.status))
            throw new AppError(400, `status must be one of: ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR");
        if (b.split_details !== undefined && (typeof b.split_details !== "object" || Array.isArray(b.split_details)))
            throw new AppError(400, "split_details must be an object", "VALIDATION_ERROR");
        if (!isOptionalString(b.notes))
            throw new AppError(400, "notes must be a string", "VALIDATION_ERROR");
        return next();
    } catch (err) { return next(err); }
};
