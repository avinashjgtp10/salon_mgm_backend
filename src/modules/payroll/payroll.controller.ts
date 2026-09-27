import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { payrollService } from "./payroll.service";
import {
    AdjustPayrollBody, PayPayrollBody, CreateSalaryAdvanceBody, UpdateSalaryAdvanceBody,
} from "./payroll.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const payrollController = {
    async staffSummary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const summary = await payrollService.getStaffSummary(
                salonId,
                String(req.query.period_start),
                String(req.query.period_end)
            );
            return sendSuccess(res, 200, { items: summary }, "Payroll staff summary fetched successfully");
        } catch (err) { return next(err); }
    },

    async adjust(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.staffId);
            const summary = await payrollService.adjustPayroll(salonId, staffId, req.body as AdjustPayrollBody, req.user?.userId ?? null);
            return sendSuccess(res, 200, summary, "Payroll adjustment recorded successfully");
        } catch (err) { return next(err); }
    },

    async pay(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.staffId);
            const result = await payrollService.payStaff(salonId, staffId, req.body as PayPayrollBody, req.user?.userId ?? null);
            return sendSuccess(res, 200, result, "Salary payment recorded successfully");
        } catch (err) { return next(err); }
    },

    async salarySlip(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.staffId);
            const { buffer, filename } = await payrollService.getSalarySlipPdf(
                salonId, staffId, String(req.query.period_start), String(req.query.period_end)
            );
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Content-Type", "application/pdf");
            return res.send(buffer);
        } catch (err) { return next(err); }
    },

    async paymentReceipt(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.staffId);
            const { buffer, filename } = await payrollService.getPaymentReceiptPdf(
                salonId, staffId, String(req.query.period_start), String(req.query.period_end)
            );
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Content-Type", "application/pdf");
            return res.send(buffer);
        } catch (err) { return next(err); }
    },

    async history(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.staffId);
            const items = await payrollService.getHistory(salonId, staffId);
            return sendSuccess(res, 200, { items }, "Payroll history fetched successfully");
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
            const advance = await payrollService.updateSalaryAdvance(String(req.params.advanceId), salonId, req.body as UpdateSalaryAdvanceBody);
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
};
