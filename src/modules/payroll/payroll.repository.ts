import pool from "../../config/database";
import { CreatePayrollEntryBody, PayrollEntry, PayrollEntryListQuery } from "./payroll.types";

export const payrollRepository = {
    async list(salonId: string, q: PayrollEntryListQuery): Promise<PayrollEntry[]> {
        const { rows } = await pool.query(
            `SELECT pe.*,
                    s.first_name     AS staff_first_name,
                    s.last_name      AS staff_last_name,
                    s.designation    AS staff_designation,
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
};

function mapRow(r: any): PayrollEntry {
    return {
        id: r.id,
        salon_id: r.salon_id,
        staff_id: r.staff_id,
        staff_first_name: r.staff_first_name,
        staff_last_name: r.staff_last_name,
        staff_designation: r.staff_designation,
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
