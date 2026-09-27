import pool from "../../config/database";
import {
    PayrollEntry, PayrollAdjustment, PayrollAdjustmentField, PayrollPayment,
    SalaryAdvanceTransaction, SalaryAdvanceListQuery, CreateSalaryAdvanceBody, UpdateSalaryAdvanceBody,
} from "./payroll.types";

export const payrollEntryRepository = {
    async findForPeriod(salonId: string, staffId: string, periodStart: string, periodEnd: string): Promise<PayrollEntry | null> {
        const { rows } = await pool.query(
            `SELECT * FROM payroll_entries WHERE salon_id = $1 AND staff_id = $2 AND period_start = $3 AND period_end = $4`,
            [salonId, staffId, periodStart, periodEnd]
        );
        return rows[0] ? mapEntry(rows[0]) : null;
    },

    async findById(id: string, salonId: string): Promise<PayrollEntry | null> {
        const { rows } = await pool.query(
            `SELECT * FROM payroll_entries WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rows[0] ? mapEntry(rows[0]) : null;
    },

    async listForPeriod(salonId: string, periodStart: string, periodEnd: string): Promise<PayrollEntry[]> {
        const { rows } = await pool.query(
            `SELECT * FROM payroll_entries WHERE salon_id = $1 AND period_start = $2 AND period_end = $3`,
            [salonId, periodStart, periodEnd]
        );
        return rows.map(mapEntry);
    },

    // Creates the period's row on first touch (e.g. first adjustment) with
    // every amount defaulting to 0 — base_salary/commission/tips are never
    // stored as the source of truth (staff-summary always recomputes them
    // live from staff_wage_settings/commission_earned/tip_earned); this row
    // exists only to hold bonus/deductions/other_earning/salary_advance/
    // status, the fields a period can actually persist.
    async ensureForPeriod(salonId: string, staffId: string, periodStart: string, periodEnd: string): Promise<PayrollEntry> {
        const existing = await this.findForPeriod(salonId, staffId, periodStart, periodEnd);
        if (existing) return existing;

        const { rows } = await pool.query(
            `INSERT INTO payroll_entries
                (salon_id, staff_id, period_type, period_start, period_end, base_salary, status)
             VALUES ($1,$2,'custom',$3,$4,0,'draft')
             ON CONFLICT (staff_id, period_start, period_end) DO UPDATE SET updated_at = NOW()
             RETURNING *`,
            [salonId, staffId, periodStart, periodEnd]
        );
        return mapEntry(rows[0]);
    },

    async updateField(id: string, salonId: string, field: PayrollAdjustmentField, value: number): Promise<PayrollEntry> {
        // Every adjustable field maps 1:1 onto a real payroll_entries column
        // except "salary" (base_salary is read-only from staff_wage_settings
        // everywhere else, but an adjustment can still override it for this
        // period specifically) and "commission"/"tips" (also normally
        // derived live — an adjustment here records a manual override that
        // staff-summary's callers apply on top of the live totals).
        const COLUMN: Record<PayrollAdjustmentField, string> = {
            commission: "commission",
            bonus: "bonus",
            tips: "tips",
            deduction: "deductions",
            other_earning: "other_earning",
            salary: "base_salary",
        };
        const column = COLUMN[field];
        const { rows } = await pool.query(
            `UPDATE payroll_entries SET ${column} = $1, status = CASE WHEN status = 'draft' THEN 'pending' ELSE status END, updated_at = NOW()
             WHERE id = $2 AND salon_id = $3
             RETURNING *`,
            [value, id, salonId]
        );
        return mapEntry(rows[0]);
    },

    async markPaid(id: string, salonId: string, paidAmount: number, paymentMethod: string): Promise<PayrollEntry> {
        const { rows } = await pool.query(
            `UPDATE payroll_entries
             SET status = 'paid', paid_amount = $1, payment_method = $2, payment_date = NOW(), locked_at = NOW(), updated_at = NOW()
             WHERE id = $3 AND salon_id = $4
             RETURNING *`,
            [paidAmount, paymentMethod, id, salonId]
        );
        return mapEntry(rows[0]);
    },
};

export const payrollAdjustmentRepository = {
    async insert(params: {
        salon_id: string; staff_id: string; payroll_entry_id: string; field: PayrollAdjustmentField;
        original_value: number; adjusted_value: number; reason: string; adjusted_by?: string | null;
    }): Promise<PayrollAdjustment> {
        const { rows } = await pool.query(
            `INSERT INTO payroll_adjustments
                (salon_id, staff_id, payroll_entry_id, field, original_value, adjusted_value, reason, adjusted_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
                params.salon_id, params.staff_id, params.payroll_entry_id, params.field,
                params.original_value, params.adjusted_value, params.reason, params.adjusted_by ?? null,
            ]
        );
        return mapAdjustment(rows[0]);
    },

    async listByEntry(payrollEntryId: string): Promise<PayrollAdjustment[]> {
        const { rows } = await pool.query(
            `SELECT * FROM payroll_adjustments WHERE payroll_entry_id = $1 ORDER BY created_at DESC`,
            [payrollEntryId]
        );
        return rows.map(mapAdjustment);
    },

    async listByStaffAcrossPeriods(salonId: string, staffId: string, limit = 100): Promise<PayrollAdjustment[]> {
        const { rows } = await pool.query(
            `SELECT * FROM payroll_adjustments WHERE salon_id = $1 AND staff_id = $2 ORDER BY created_at DESC LIMIT $3`,
            [salonId, staffId, limit]
        );
        return rows.map(mapAdjustment);
    },
};

export const payrollPaymentRepository = {
    async findByEntryId(payrollEntryId: string): Promise<PayrollPayment | null> {
        const { rows } = await pool.query(
            `SELECT * FROM payroll_payments WHERE payroll_entry_id = $1`,
            [payrollEntryId]
        );
        return rows[0] ? mapPayment(rows[0]) : null;
    },

    // Insert relies on the UNIQUE(payroll_entry_id) constraint as the real
    // duplicate-payment guard — a second insert for the same entry throws a
    // 23505 the caller's transaction rolls back on, not just this
    // pre-flight findByEntryId check (which only closes the common case
    // without a DB round-trip race).
    async insert(client: import("pg").PoolClient, params: {
        salon_id: string; staff_id: string; payroll_entry_id: string; amount: number;
        payment_method: string; payment_reference?: string | null; paid_by?: string | null;
    }): Promise<PayrollPayment> {
        const { rows } = await client.query(
            `INSERT INTO payroll_payments
                (salon_id, staff_id, payroll_entry_id, amount, payment_method, payment_reference, paid_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
                params.salon_id, params.staff_id, params.payroll_entry_id, params.amount,
                params.payment_method, params.payment_reference ?? null, params.paid_by ?? null,
            ]
        );
        return mapPayment(rows[0]);
    },

    async markReceiptSent(id: string): Promise<void> {
        await pool.query(`UPDATE payroll_payments SET receipt_sent_at = NOW() WHERE id = $1`, [id]);
    },
};

export const salaryAdvanceRepository = {
    async list(salonId: string, q: SalaryAdvanceListQuery): Promise<SalaryAdvanceTransaction[]> {
        const values: unknown[] = [salonId, q.period_start, q.period_end];
        const staffFilter = q.staff_id ? "AND psa.staff_id = $4" : "";
        if (q.staff_id) values.push(q.staff_id);

        const { rows } = await pool.query(
            `SELECT psa.*, s.first_name AS staff_first_name, s.last_name AS staff_last_name
             FROM payroll_salary_advances psa
             JOIN staff s ON s.id = psa.staff_id
             WHERE psa.salon_id = $1 AND psa.payroll_period_start = $2 AND psa.payroll_period_end = $3 ${staffFilter}
             ORDER BY psa.advance_date DESC, psa.created_at DESC`,
            values
        );
        return rows.map(mapSalaryAdvance);
    },

    async findById(id: string, salonId: string): Promise<SalaryAdvanceTransaction | null> {
        const { rows } = await pool.query(
            `SELECT psa.*, s.first_name AS staff_first_name, s.last_name AS staff_last_name
             FROM payroll_salary_advances psa
             JOIN staff s ON s.id = psa.staff_id
             WHERE psa.id = $1 AND psa.salon_id = $2`,
            [id, salonId]
        );
        return rows[0] ? mapSalaryAdvance(rows[0]) : null;
    },

    async create(salonId: string, data: CreateSalaryAdvanceBody): Promise<SalaryAdvanceTransaction> {
        const { rows } = await pool.query(
            `INSERT INTO payroll_salary_advances
                (salon_id, staff_id, amount, advance_date, payroll_period_start, payroll_period_end, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id`,
            [salonId, data.staff_id, data.amount, data.advance_date, data.payroll_period_start, data.payroll_period_end, data.note ?? null]
        );
        return (await this.findById(rows[0].id, salonId))!;
    },

    async update(id: string, salonId: string, data: UpdateSalaryAdvanceBody): Promise<SalaryAdvanceTransaction | null> {
        const allowedFields: (keyof UpdateSalaryAdvanceBody)[] = ["amount", "advance_date", "note"];
        const updates = allowedFields.filter((field) => data[field] !== undefined);
        if (updates.length === 0) return this.findById(id, salonId);

        const assignments = updates.map((field, index) => `${field} = $${index + 3}`);
        const values = updates.map((field) => data[field]);
        const { rows } = await pool.query(
            `UPDATE payroll_salary_advances SET ${assignments.join(", ")}, updated_at = NOW()
             WHERE id = $1 AND salon_id = $2 RETURNING id`,
            [id, salonId, ...values]
        );
        if (!rows[0]) return null;
        return this.findById(id, salonId);
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM payroll_salary_advances WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },

    // Total advances taken for a staff member within a period — folded into
    // the staff-summary aggregate the same way commission/tips are.
    async totalForPeriod(salonId: string, staffId: string, periodStart: string, periodEnd: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM payroll_salary_advances
             WHERE salon_id = $1 AND staff_id = $2 AND payroll_period_start = $3 AND payroll_period_end = $4`,
            [salonId, staffId, periodStart, periodEnd]
        );
        return parseFloat(rows[0].total);
    },
};

function mapEntry(r: any): PayrollEntry {
    return {
        id: r.id,
        salon_id: r.salon_id,
        staff_id: r.staff_id,
        period_type: r.period_type,
        period_start: r.period_start,
        period_end: r.period_end,
        base_salary: parseFloat(r.base_salary),
        commission: parseFloat(r.commission),
        tips: parseFloat(r.tips),
        bonus: parseFloat(r.bonus),
        salary_advance: parseFloat(r.salary_advance),
        deductions: parseFloat(r.deductions),
        other_earning: parseFloat(r.other_earning ?? 0),
        paid_amount: parseFloat(r.paid_amount),
        payment_method: r.payment_method,
        payment_date: r.payment_date,
        status: r.status,
        locked_at: r.locked_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
}

function mapAdjustment(r: any): PayrollAdjustment {
    return {
        id: r.id,
        salon_id: r.salon_id,
        staff_id: r.staff_id,
        payroll_entry_id: r.payroll_entry_id,
        field: r.field,
        original_value: parseFloat(r.original_value),
        adjusted_value: parseFloat(r.adjusted_value),
        reason: r.reason,
        adjusted_by: r.adjusted_by,
        created_at: r.created_at,
    };
}

function mapPayment(r: any): PayrollPayment {
    return {
        id: r.id,
        salon_id: r.salon_id,
        staff_id: r.staff_id,
        payroll_entry_id: r.payroll_entry_id,
        amount: parseFloat(r.amount),
        payment_method: r.payment_method,
        payment_reference: r.payment_reference,
        paid_by: r.paid_by,
        paid_at: r.paid_at,
        receipt_sent_at: r.receipt_sent_at,
    };
}

function mapSalaryAdvance(r: any): SalaryAdvanceTransaction {
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
