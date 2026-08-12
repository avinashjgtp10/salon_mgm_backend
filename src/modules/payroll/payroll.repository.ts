import pool from "../../config/database";
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

export const payrollRepository = {
    async list(salonId: string, q: PayrollEntryListQuery): Promise<PayrollEntry[]> {
        const { rows } = await pool.query(
            `SELECT pe.*,
                    s.first_name     AS staff_first_name,
                    s.last_name      AS staff_last_name,
                    s.designation    AS staff_designation,
                    s.permission_level AS staff_permission_level,
                    s.calendar_color AS staff_calendar_color
             FROM payroll_entries pe
             JOIN staff s ON s.id = pe.staff_id
             WHERE pe.salon_id = $1 AND pe.period_start = $2 AND pe.period_end = $3
             ORDER BY s.first_name ASC`,
            [salonId, q.period_start, q.period_end]
        );
        return rows.map(mapRow);
    },

    async findById(id: string, salonId: string): Promise<PayrollEntry | null> {
        const { rows } = await pool.query(
            `SELECT pe.*,
                    s.first_name     AS staff_first_name,
                    s.last_name      AS staff_last_name,
                    s.designation    AS staff_designation,
                    s.permission_level AS staff_permission_level,
                    s.calendar_color AS staff_calendar_color
             FROM payroll_entries pe
             JOIN staff s ON s.id = pe.staff_id
             WHERE pe.id = $1 AND pe.salon_id = $2`,
            [id, salonId]
        );
        return rows[0] ? mapRow(rows[0]) : null;
    },

    async create(salonId: string, data: CreatePayrollEntryBody): Promise<PayrollEntry> {
        const { rows } = await pool.query(
            `INSERT INTO payroll_entries
                (salon_id, staff_id, period_type, period_start, period_end,
                 base_salary, commission, tips, bonus, salary_advance, deductions)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id`,
            [
                salonId, data.staff_id, data.period_type, data.period_start, data.period_end,
                data.base_salary, data.commission ?? 0, data.tips ?? 0, data.bonus ?? 0,
                data.salary_advance ?? 0, data.deductions ?? 0,
            ]
        );
        return (await this.findById(rows[0].id, salonId))!;
    },

    async update(id: string, salonId: string, data: UpdatePayrollEntryBody): Promise<PayrollEntry | null> {
        const allowedFields: (keyof UpdatePayrollEntryBody)[] = [
            "base_salary",
            "commission",
            "tips",
            "bonus",
            "salary_advance",
            "deductions",
        ];
        const updates = allowedFields.filter((field) => data[field] !== undefined);
        if (updates.length === 0) return this.findById(id, salonId);

        const assignments = updates.map((field, index) => `${field} = $${index + 3}`);
        const values = updates.map((field) => data[field]);
        const { rows } = await pool.query(
            `UPDATE payroll_entries
             SET ${assignments.join(", ")}, updated_at = NOW()
             WHERE id = $1 AND salon_id = $2
             RETURNING id`,
            [id, salonId, ...values]
        );
        if (!rows[0]) return null;
        return this.findById(id, salonId);
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM payroll_entries
             WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rowCount > 0;
    },

    async recordPayment(id: string, salonId: string, amount: number, method: string, date: string): Promise<PayrollEntry | null> {
        const { rows } = await pool.query(
            `UPDATE payroll_entries
             SET paid_amount = paid_amount + $1, payment_method = $2, payment_date = $3, updated_at = NOW()
             WHERE id = $4 AND salon_id = $5
             RETURNING id`,
            [amount, method, date, id, salonId]
        );
        if (!rows[0]) return null;
        return this.findById(id, salonId);
    },

    async attendanceSummary(salonId: string, staffId: string, startDate: string, endDate: string) {
        const { rows } = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE LOWER(REPLACE(a.status, ' ', '_')) = 'half_day')::int AS total_half_days,
                COUNT(*) FILTER (WHERE LOWER(REPLACE(a.status, ' ', '_')) = 'present')::int AS total_present_days,
                COUNT(*) FILTER (WHERE LOWER(REPLACE(a.status, ' ', '_')) = 'absent')::int AS total_absent_days,
                COUNT(*) FILTER (WHERE LOWER(REPLACE(a.status, ' ', '_')) = 'late')::int AS total_late_days,
                COUNT(*) FILTER (
                    WHERE LOWER(REPLACE(a.status, ' ', '_')) IN ('present', 'half_day', 'absent', 'late')
                )::int AS total_working_days
             FROM attendance a
             WHERE a.salon_id = $1
               AND a.staff_id = $2
               AND DATE(a.date) BETWEEN $3::date AND $4::date`,
            [salonId, staffId, startDate, endDate]
        );
        const row = rows[0] ?? {};
        return {
            staff_id: staffId,
            total_half_days: Number(row.total_half_days) || 0,
            total_present_days: Number(row.total_present_days) || 0,
            total_absent_days: Number(row.total_absent_days) || 0,
            total_late_days: Number(row.total_late_days) || 0,
            total_working_days: Number(row.total_working_days) || 0,
        };
    },

    async listSalaryAdvances(salonId: string, q: SalaryAdvanceListQuery): Promise<SalaryAdvanceTransaction[]> {
        const values: unknown[] = [salonId, q.period_start, q.period_end];
        const staffFilter = q.staff_id ? "AND psa.staff_id = $4" : "";
        if (q.staff_id) values.push(q.staff_id);

        const { rows } = await pool.query(
            `SELECT psa.*,
                    s.first_name AS staff_first_name,
                    s.last_name  AS staff_last_name
             FROM payroll_salary_advances psa
             JOIN staff s ON s.id = psa.staff_id
             WHERE psa.salon_id = $1
               AND psa.payroll_period_start = $2
               AND psa.payroll_period_end = $3
               ${staffFilter}
             ORDER BY psa.advance_date DESC, psa.created_at DESC`,
            values
        );
        return rows.map(mapSalaryAdvanceRow);
    },

    async createSalaryAdvance(salonId: string, data: CreateSalaryAdvanceBody): Promise<SalaryAdvanceTransaction> {
        const { rows } = await pool.query(
            `INSERT INTO payroll_salary_advances
                (salon_id, staff_id, amount, advance_date, payroll_period_start, payroll_period_end, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id`,
            [
                salonId,
                data.staff_id,
                data.amount,
                data.advance_date,
                data.payroll_period_start,
                data.payroll_period_end,
                data.note ?? null,
            ]
        );
        return (await this.findSalaryAdvanceById(rows[0].id, salonId))!;
    },

    async findSalaryAdvanceById(id: string, salonId: string): Promise<SalaryAdvanceTransaction | null> {
        const { rows } = await pool.query(
            `SELECT psa.*,
                    s.first_name AS staff_first_name,
                    s.last_name  AS staff_last_name
             FROM payroll_salary_advances psa
             JOIN staff s ON s.id = psa.staff_id
             WHERE psa.id = $1 AND psa.salon_id = $2`,
            [id, salonId]
        );
        return rows[0] ? mapSalaryAdvanceRow(rows[0]) : null;
    },

    async updateSalaryAdvance(id: string, salonId: string, data: UpdateSalaryAdvanceBody): Promise<SalaryAdvanceTransaction | null> {
        const allowedFields: (keyof UpdateSalaryAdvanceBody)[] = ["amount", "advance_date", "note"];
        const updates = allowedFields.filter((field) => data[field] !== undefined);
        if (updates.length === 0) return this.findSalaryAdvanceById(id, salonId);

        const assignments = updates.map((field, index) => `${field} = $${index + 3}`);
        const values = updates.map((field) => data[field]);
        const { rows } = await pool.query(
            `UPDATE payroll_salary_advances
             SET ${assignments.join(", ")}, updated_at = NOW()
             WHERE id = $1 AND salon_id = $2
             RETURNING id`,
            [id, salonId, ...values]
        );
        if (!rows[0]) return null;
        return this.findSalaryAdvanceById(id, salonId);
    },

    async deleteSalaryAdvance(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM payroll_salary_advances
             WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rowCount > 0;
    },
};

function mapRow(r: any): PayrollEntry {
    return {
        id: r.id,
        salon_id: r.salon_id,
        staff_id: r.staff_id,
        staff_first_name: r.staff_first_name,
        staff_last_name: r.staff_last_name,
        staff_designation: r.staff_designation,
        staff_permission_level: r.staff_permission_level,
        staff_calendar_color: r.staff_calendar_color,
        period_type: r.period_type,
        period_start: r.period_start,
        period_end: r.period_end,
        base_salary: parseFloat(r.base_salary),
        commission: parseFloat(r.commission),
        tips: parseFloat(r.tips),
        bonus: parseFloat(r.bonus),
        salary_advance: parseFloat(r.salary_advance),
        deductions: parseFloat(r.deductions),
        paid_amount: parseFloat(r.paid_amount),
        payment_method: r.payment_method,
        payment_date: r.payment_date,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}

function mapSalaryAdvanceRow(r: any): SalaryAdvanceTransaction {
    return {
        id: r.id,
        salon_id: r.salon_id,
        staff_id: r.staff_id,
        staff_first_name: r.staff_first_name,
        staff_last_name: r.staff_last_name,
        amount: parseFloat(r.amount),
        advance_date: r.advance_date,
        payroll_period_start: r.payroll_period_start,
        payroll_period_end: r.payroll_period_end,
        note: r.note,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}
