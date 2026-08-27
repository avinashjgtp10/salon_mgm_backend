import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { PayoutMethod } from "./inventory.types";

const PAYOUT_METHODS: PayoutMethod[] = ["cash", "upi", "bank_transfer", "cheque", "card", "other"];
const isIsoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const validateCreateSupplierPayment = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount <= 0) {
            throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
        }
        if (!isIsoDate(b.payment_date)) {
            throw new AppError(400, "payment_date (YYYY-MM-DD) is required", "VALIDATION_ERROR");
        }
        if (!PAYOUT_METHODS.includes(b.payment_method)) {
            throw new AppError(400, `payment_method must be one of: ${PAYOUT_METHODS.join(", ")}`, "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
