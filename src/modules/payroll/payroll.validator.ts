import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { PayrollPeriodType } from "./payroll.types";

const VALID_PERIOD_TYPES: PayrollPeriodType[] = ["weekly", "biweekly", "monthly", "custom"];

const isNonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isIsoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isNonNegativeNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export const validateListPayrollEntries = (req: Request, _res: Response, next: NextFunction) => {
    try {
        if (!isIsoDate(req.query.period_start) || !isIsoDate(req.query.period_end)) {
            throw new AppError(400, "period_start and period_end (YYYY-MM-DD) are required", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};

export const validateCreatePayrollEntry = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (!isNonEmptyString(b.staff_id)) {
            throw new AppError(400, "staff_id is required", "VALIDATION_ERROR");
        }
        if (!VALID_PERIOD_TYPES.includes(b.period_type)) {
            throw new AppError(400, `period_type must be one of: ${VALID_PERIOD_TYPES.join(", ")}`, "VALIDATION_ERROR");
        }
        if (!isIsoDate(b.period_start) || !isIsoDate(b.period_end)) {
            throw new AppError(400, "period_start and period_end (YYYY-MM-DD) are required", "VALIDATION_ERROR");
        }
        if (!isNonNegativeNumber(b.base_salary)) {
            throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
        }
        for (const field of ["commission", "tips", "bonus", "salary_advance", "deductions"] as const) {
            if (b[field] !== undefined && !isNonNegativeNumber(b[field])) {
                throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
            }
        }
        return next();
    } catch (err) { return next(err); }
};

export const validatePayPayrollEntry = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const b = req.body;
        if (typeof b.amount !== "number" || !Number.isFinite(b.amount)) {
            throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
        }
        if (!isNonEmptyString(b.payment_method)) {
            throw new AppError(400, "payment_method is required", "VALIDATION_ERROR");
        }
        if (!isIsoDate(b.payment_date)) {
            throw new AppError(400, "payment_date (YYYY-MM-DD) is required", "VALIDATION_ERROR");
        }
        return next();
    } catch (err) { return next(err); }
};
