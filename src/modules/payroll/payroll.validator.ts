import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";

const ADJUSTMENT_FIELDS = ["commission", "bonus", "tips", "deduction", "other_earning", "salary"];

export function validateStaffSummaryQuery(req: Request, _res: Response, next: NextFunction) {
    const { period_start, period_end } = req.query;
    if (!period_start || !period_end) {
        return next(new AppError(400, "period_start and period_end are required", "VALIDATION_ERROR"));
    }
    return next();
}

export function validateAdjustPayroll(req: Request, _res: Response, next: NextFunction) {
    const { period_start, period_end, field, adjusted_value, reason } = req.body ?? {};
    if (!period_start || !period_end) {
        return next(new AppError(400, "period_start and period_end are required", "VALIDATION_ERROR"));
    }
    if (!field || !ADJUSTMENT_FIELDS.includes(field)) {
        return next(new AppError(400, `field must be one of: ${ADJUSTMENT_FIELDS.join(", ")}`, "VALIDATION_ERROR"));
    }
    if (typeof adjusted_value !== "number" || !Number.isFinite(adjusted_value)) {
        return next(new AppError(400, "adjusted_value must be a number", "VALIDATION_ERROR"));
    }
    if (!reason || !String(reason).trim()) {
        return next(new AppError(400, "A reason is required for every payroll adjustment", "VALIDATION_ERROR"));
    }
    return next();
}

export function validatePayPayroll(req: Request, _res: Response, next: NextFunction) {
    const { period_start, period_end, payment_method } = req.body ?? {};
    if (!period_start || !period_end) {
        return next(new AppError(400, "period_start and period_end are required", "VALIDATION_ERROR"));
    }
    if (!payment_method || !String(payment_method).trim()) {
        return next(new AppError(400, "payment_method is required", "VALIDATION_ERROR"));
    }
    return next();
}

export function validateCreateSalaryAdvance(req: Request, _res: Response, next: NextFunction) {
    const { staff_id, amount, advance_date, payroll_period_start, payroll_period_end } = req.body ?? {};
    if (!staff_id) return next(new AppError(400, "staff_id is required", "VALIDATION_ERROR"));
    if (typeof amount !== "number" || amount <= 0) return next(new AppError(400, "amount must be a positive number", "VALIDATION_ERROR"));
    if (!advance_date || !payroll_period_start || !payroll_period_end) {
        return next(new AppError(400, "advance_date, payroll_period_start and payroll_period_end are required", "VALIDATION_ERROR"));
    }
    return next();
}
