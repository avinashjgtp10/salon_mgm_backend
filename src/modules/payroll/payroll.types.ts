export type PayrollPeriodType = "weekly" | "biweekly" | "monthly" | "custom";

export type PayrollEntry = {
    id: string;
    salon_id: string;
    staff_id: string;
    staff_first_name: string;
    staff_last_name: string | null;
    staff_designation: string | null;
    staff_calendar_color: string | null;
    period_type: PayrollPeriodType;
    period_start: string;
    period_end: string;
    base_salary: number;
    commission: number;
    tips: number;
    bonus: number;
    salary_advance: number;
    deductions: number;
    paid_amount: number;
    payment_method: string | null;
    payment_date: string | null;
    created_at: string;
    updated_at: string;
};

export type CreatePayrollEntryBody = {
    staff_id: string;
    period_type: PayrollPeriodType;
    period_start: string;
    period_end: string;
    base_salary: number;
    commission?: number;
    tips?: number;
    bonus?: number;
    salary_advance?: number;
    deductions?: number;
};

export type UpdatePayrollEntryBody = Partial<Pick<
    CreatePayrollEntryBody,
    "base_salary" | "commission" | "tips" | "bonus" | "salary_advance" | "deductions"
>>;

export type PayPayrollEntryBody = {
    amount: number;
    payment_method: string;
    payment_date: string;
};

export type PayrollEntryListQuery = {
    period_start: string;
    period_end: string;
};

export type SalaryAdvanceTransaction = {
    id: string;
    salon_id: string;
    staff_id: string;
    staff_first_name: string;
    staff_last_name: string | null;
    amount: number;
    advance_date: string;
    payroll_period_start: string;
    payroll_period_end: string;
    note: string | null;
    created_at: string;
    updated_at: string;
};

export type SalaryAdvanceListQuery = {
    period_start: string;
    period_end: string;
    staff_id?: string;
};

export type CreateSalaryAdvanceBody = {
    staff_id: string;
    amount: number;
    advance_date: string;
    payroll_period_start: string;
    payroll_period_end: string;
    note?: string;
};

export type UpdateSalaryAdvanceBody = Partial<Pick<CreateSalaryAdvanceBody, "amount" | "advance_date" | "note">>;
