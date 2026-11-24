export type PayrollEntryStatus = "draft" | "pending" | "paid";
export type PayrollAdjustmentField = "commission" | "bonus" | "tips" | "deduction" | "other_earning" | "salary" | "salary_advance";

export type PayrollEntry = {
    id: string;
    salon_id: string;
    staff_id: string;
    period_type: "custom";
    period_start: string;
    period_end: string;
    base_salary: number;
    commission: number;
    tips: number;
    bonus: number;
    salary_advance: number;
    deductions: number;
    other_earning: number;
    paid_amount: number;
    payment_method: string | null;
    payment_date: string | null;
    status: PayrollEntryStatus;
    locked_at: string | null;
    created_at: string;
    updated_at: string;
};

export type CommissionByCategory = {
    services: number;
    products: number;
    memberships: number;
    packages: number;
    other: number;
};

export type StaffPayrollSummary = {
    staff_id: string;
    staff_first_name: string;
    staff_last_name: string | null;
    staff_email: string;
    staff_calendar_color: string | null;
    staff_designation: string | null;
    base_salary: number;
    compensation_type: string;
    // Only meaningful when compensation_type === "hourly": base_salary = hours_worked x hourly_rate.
    hourly_rate: number | null;
    hours_worked: number | null;
    commission_by_category: CommissionByCategory;
    commission_total: number;
    tips_total: number;
    tips_pending: number;
    tips_paid: number;
    bonus: number;
    deductions: number;
    other_earning: number;
    salary_advance: number;
    net_salary: number;
    status: PayrollEntryStatus;
    payment_method: string | null;
    payment_date: string | null;
    payroll_entry_id: string | null;
    adjustments: PayrollAdjustment[];
};

// Everything the staff Payroll "Salary Statement" page prints, in one response.
export type PayrollStatement = {
    summary: StaffPayrollSummary;
    salon: { business_name: string; logo_url: string | null; email: string | null; phone: string | null; currency: string | null };
    branch: { name: string | null; address: string | null; phone: string | null; email: string | null };
    employee: { name: string; designation: string | null; employee_code: string | null; joined_date: string | null };
    document: { payroll_id: string; generated_on: string };
    attendance: {
        scheduled_days: number;
        working_days: number;
        half_days: number;
        leave_days: number;
        absent_days: number;
        late_marks: number;
        total_hours: number;
    };
    payment: { amount: number; method: string; reference: string | null; paid_at: string; receipt_no: string } | null;
    amount_in_words: string | null;
};

export type PayrollAdjustment = {
    id: string;
    salon_id: string;
    staff_id: string;
    payroll_entry_id: string;
    field: PayrollAdjustmentField;
    original_value: number;
    adjusted_value: number;
    reason: string;
    adjusted_by: string | null;
    created_at: string;
};

export type AdjustPayrollBody = {
    period_start: string;
    period_end: string;
    field: PayrollAdjustmentField;
    adjusted_value: number;
    reason: string;
};

export type PayPayrollBody = {
    period_start: string;
    period_end: string;
    payment_method: string;
    payment_reference?: string;
};

export type PayrollPayment = {
    id: string;
    salon_id: string;
    staff_id: string;
    payroll_entry_id: string;
    amount: number;
    payment_method: string;
    payment_reference: string | null;
    paid_by: string | null;
    paid_at: string;
    receipt_sent_at: string | null;
};

// ─── Salary advances (unchanged from the pre-existing module) ─────────────

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
