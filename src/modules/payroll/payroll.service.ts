import { AppError } from "../../middleware/error.middleware";
import { payrollRepository } from "./payroll.repository";
import { CreatePayrollEntryBody, PayrollEntry, PayrollEntryListQuery } from "./payroll.types";

function netPay(e: Pick<PayrollEntry, "base_salary" | "commission" | "tips" | "bonus" | "salary_advance" | "deductions">): number {
    return e.base_salary + e.commission + e.tips + e.bonus - e.salary_advance - e.deductions;
}

export const payrollService = {
    async list(salonId: string, query: PayrollEntryListQuery): Promise<PayrollEntry[]> {
        return payrollRepository.list(salonId, query);
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
