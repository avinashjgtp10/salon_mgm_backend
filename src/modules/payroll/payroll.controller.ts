import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { payrollService } from "./payroll.service";
import { CreatePayrollEntryBody, CreateSalaryAdvanceBody, UpdatePayrollEntryBody, UpdateSalaryAdvanceBody } from "./payroll.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const payrollController = {
    async attendanceSummary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const summary = await payrollService.attendanceSummary(
                salonId,
                String(req.query.staff_id ?? ""),
                String(req.query.start_date ?? ""),
                String(req.query.end_date ?? ""),
            );
            return sendSuccess(res, 200, summary, "Payroll attendance summary fetched successfully");
        } catch (err) { return next(err); }
    },

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

    async listSalaryAdvances(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const items = await payrollService.listSalaryAdvances(salonId, {
                period_start: String(req.query.period_start ?? ""),
                period_end: String(req.query.period_end ?? ""),
                staff_id: req.query.staff_id ? String(req.query.staff_id) : undefined,
            });
            return sendSuccess(res, 200, { items }, "Salary advances fetched successfully");
        } catch (err) { return next(err); }
    },

    async createSalaryAdvance(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const advance = await payrollService.createSalaryAdvance(salonId, req.body as CreateSalaryAdvanceBody);
            return sendSuccess(res, 201, advance, "Salary advance added successfully");
        } catch (err) { return next(err); }
    },

    async updateSalaryAdvance(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const advance = await payrollService.updateSalaryAdvance(
                String(req.params.advanceId),
                salonId,
                req.body as UpdateSalaryAdvanceBody
            );
            return sendSuccess(res, 200, advance, "Salary advance updated successfully");
        } catch (err) { return next(err); }
    },

    async deleteSalaryAdvance(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.advanceId);
            await payrollService.deleteSalaryAdvance(id, salonId);
            return sendSuccess(res, 200, { id }, "Salary advance deleted successfully");
        } catch (err) { return next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id);
            const entry = await payrollService.updateEntry(id, salonId, req.body as UpdatePayrollEntryBody);
            return sendSuccess(res, 200, entry, "Payroll entry updated successfully");
        } catch (err) { return next(err); }
    },

    async delete(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id);
            await payrollService.deleteEntry(id, salonId);
            return sendSuccess(res, 200, { id }, "Payroll entry deleted successfully");
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
