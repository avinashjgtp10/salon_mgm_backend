import { AppError } from "../../middleware/error.middleware";
import { payrollRepository } from "./payroll.repository";
import {
    CreatePayrollEntryBody,
    CreateSalaryAdvanceBody,
    PayrollEntry,
    PayrollEntryListQuery,
    SalaryAdvanceListQuery,
    SalaryAdvanceTransaction,
    UpdatePayrollEntryBody,
    UpdateSalaryAdvanceBody,
} from "./payroll.types";

function netPay(e: Pick<PayrollEntry, "base_salary" | "commission" | "tips" | "bonus" | "salary_advance" | "deductions">): number {
    return e.base_salary + e.commission + e.tips + e.bonus - e.salary_advance - e.deductions;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateIsoDate(value: string, field: string) {
    if (!ISO_DATE_RE.test(value)) {
        throw new AppError(400, `${field} is required`, "VALIDATION_ERROR");
    }
}

function validateAdvanceAmount(value: unknown) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new AppError(400, "Please enter a valid advance amount", "VALIDATION_ERROR");
    }
    return amount;
}

export const payrollService = {
    async list(salonId: string, query: PayrollEntryListQuery): Promise<PayrollEntry[]> {
        return payrollRepository.list(salonId, query);
    },

    async attendanceSummary(salonId: string, staffId: string, startDate: string, endDate: string) {
        if (!staffId) throw new AppError(400, "staff_id is required", "VALIDATION_ERROR");
        if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
            throw new AppError(400, "start_date and end_date are required", "VALIDATION_ERROR");
        }
        return payrollRepository.attendanceSummary(salonId, staffId, startDate, endDate);
    },

    async create(salonId: string, data: CreatePayrollEntryBody): Promise<PayrollEntry> {
        if (data.base_salary < 0) {
            throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
        }
        try {
            return await payrollRepository.create(salonId, data);
        } catch (err: any) {
            // unique_violation on (staff_id, period_start, period_end)
            if (err?.code === "23505") {
                throw new AppError(409, "This staff member already has a payroll entry for this period", "DUPLICATE_ENTRY");
            }
            throw err;
        }
    },

    async updateEntry(id: string, salonId: string, data: UpdatePayrollEntryBody): Promise<PayrollEntry> {
        const entry = await payrollRepository.findById(id, salonId);
        if (!entry) throw new AppError(404, "Payroll entry not found", "NOT_FOUND");

        const allowedFields: (keyof UpdatePayrollEntryBody)[] = [
            "base_salary",
            "commission",
            "tips",
            "bonus",
            "salary_advance",
            "deductions",
        ];
        for (const field of allowedFields) {
            const value = data[field];
            if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
                throw new AppError(400, `Please enter a valid amount for ${field}`, "VALIDATION_ERROR");
            }
        }

        const normalized: UpdatePayrollEntryBody = {
            base_salary: data.base_salary !== undefined ? Number(data.base_salary) : undefined,
            commission: data.commission !== undefined ? Number(data.commission) : undefined,
            tips: data.tips !== undefined ? Number(data.tips) : undefined,
            bonus: data.bonus !== undefined ? Number(data.bonus) : undefined,
            salary_advance: data.salary_advance !== undefined ? Number(data.salary_advance) : undefined,
            deductions: data.deductions !== undefined ? Number(data.deductions) : undefined,
        };
        const updated = await payrollRepository.update(id, salonId, normalized);
        if (!updated) throw new AppError(404, "Payroll entry not found", "NOT_FOUND");
        return updated;
    },

    async deleteEntry(id: string, salonId: string): Promise<void> {
        const deleted = await payrollRepository.delete(id, salonId);
        if (!deleted) throw new AppError(404, "Payroll entry not found", "NOT_FOUND");
    },

    async listSalaryAdvances(salonId: string, query: SalaryAdvanceListQuery): Promise<SalaryAdvanceTransaction[]> {
        validateIsoDate(query.period_start, "period_start");
        validateIsoDate(query.period_end, "period_end");
        return payrollRepository.listSalaryAdvances(salonId, query);
    },

    async createSalaryAdvance(salonId: string, data: CreateSalaryAdvanceBody): Promise<SalaryAdvanceTransaction> {
        if (!data.staff_id) throw new AppError(400, "staff_id is required", "VALIDATION_ERROR");
        const amount = validateAdvanceAmount(data.amount);
        validateIsoDate(data.advance_date, "advance_date");
        validateIsoDate(data.payroll_period_start, "payroll_period_start");
        validateIsoDate(data.payroll_period_end, "payroll_period_end");
        if (data.advance_date < data.payroll_period_start || data.advance_date > data.payroll_period_end) {
            throw new AppError(400, "Advance date must be inside the payroll period", "VALIDATION_ERROR");
        }
        return payrollRepository.createSalaryAdvance(salonId, {
            ...data,
            amount,
            note: data.note?.trim() || undefined,
        });
    },

    async updateSalaryAdvance(id: string, salonId: string, data: UpdateSalaryAdvanceBody): Promise<SalaryAdvanceTransaction> {
        const existing = await payrollRepository.findSalaryAdvanceById(id, salonId);
        if (!existing) throw new AppError(404, "Salary advance not found", "NOT_FOUND");

        const nextAmount = data.amount !== undefined ? validateAdvanceAmount(data.amount) : undefined;
        if (data.advance_date !== undefined) {
            validateIsoDate(data.advance_date, "advance_date");
            if (data.advance_date < existing.payroll_period_start || data.advance_date > existing.payroll_period_end) {
                throw new AppError(400, "Advance date must be inside the payroll period", "VALIDATION_ERROR");
            }
        }

        const updates: UpdateSalaryAdvanceBody = {};
        if (nextAmount !== undefined) updates.amount = nextAmount;
        if (data.advance_date !== undefined) updates.advance_date = data.advance_date;
        if (data.note !== undefined) updates.note = data.note.trim() || "";

        const updated = await payrollRepository.updateSalaryAdvance(id, salonId, updates);
        if (!updated) throw new AppError(404, "Salary advance not found", "NOT_FOUND");
        return updated;
    },

    async deleteSalaryAdvance(id: string, salonId: string): Promise<void> {
        const deleted = await payrollRepository.deleteSalaryAdvance(id, salonId);
        if (!deleted) throw new AppError(404, "Salary advance not found", "NOT_FOUND");
    },

    async payEntry(id: string, salonId: string, amount: number, method: string, date: string): Promise<PayrollEntry> {
        const entry = await payrollRepository.findById(id, salonId);
        if (!entry) throw new AppError(404, "Payroll entry not found", "NOT_FOUND");

        const pending = Math.max(0, netPay(entry) - entry.paid_amount);

        if (!Number.isFinite(amount)) {
            throw new AppError(400, "Please enter a valid amount", "VALIDATION_ERROR");
        }
        if (amount <= 0) {
            throw new AppError(400, "Amount must be greater than zero", "VALIDATION_ERROR");
        }
        if (amount > pending) {
            throw new AppError(400, "Amount cannot be greater than pending salary", "VALIDATION_ERROR");
        }

        const updated = await payrollRepository.recordPayment(id, salonId, amount, method, date);
        if (!updated) throw new AppError(404, "Payroll entry not found", "NOT_FOUND");
        return updated;
    },
};
