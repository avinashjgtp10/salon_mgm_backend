import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { payrollService } from "./payroll.service";
import { CreatePayrollEntryBody } from "./payroll.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const payrollController = {
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const entries = await payrollService.list(salonId, {
                period_start: String(req.query.period_start),
                period_end: String(req.query.period_end),
            });
            return sendSuccess(res, 200, { items: entries }, "Payroll entries fetched successfully");
        } catch (err) { return next(err); }
    },

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const entry = await payrollService.create(salonId, req.body as CreatePayrollEntryBody);
            return sendSuccess(res, 201, entry, "Payroll updated successfully");
        } catch (err) { return next(err); }
    },

    async pay(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id);
            const { amount, payment_method, payment_date } = req.body;
            const entry = await payrollService.payEntry(id, salonId, Number(amount), payment_method, payment_date);
            return sendSuccess(res, 200, entry, "Salary payment recorded successfully");
        } catch (err) { return next(err); }
    },
};
