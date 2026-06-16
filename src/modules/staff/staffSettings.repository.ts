import pool from "../../config/database";
import {
    StaffWageSettings, StaffCommissionSettings, StaffPayRunSettings, StaffSchedule,
    UpdateWageSettingsBody, UpdateCommissionBody, UpdatePayRunBody,
    UpsertStaffSchedulesBody, CommissionCategory,
} from "./staff.types";

// ─── Wages ────────────────────────────────────────────────────────────────────

export const staffWagesRepository = {
    async findByStaffId(staffId: string): Promise<StaffWageSettings | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_wage_settings WHERE staff_id = $1`, [staffId]
        );
        return rows[0] || null;
    },

    async upsert(staffId: string, data: UpdateWageSettingsBody): Promise<StaffWageSettings> {
        const { rows } = await pool.query(
            `INSERT INTO staff_wage_settings (
                staff_id, wages_enabled, compensation_type, hourly_rate, salary_amount,
                location_restriction, auto_clock_in, auto_clock_out, automated_breaks
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (staff_id) DO UPDATE SET
                wages_enabled = EXCLUDED.wages_enabled,
                compensation_type = EXCLUDED.compensation_type,
                hourly_rate = EXCLUDED.hourly_rate,
                salary_amount = EXCLUDED.salary_amount,
                location_restriction = EXCLUDED.location_restriction,
                auto_clock_in = EXCLUDED.auto_clock_in,
                auto_clock_out = EXCLUDED.auto_clock_out,
                automated_breaks = EXCLUDED.automated_breaks,
                updated_at = NOW()
            RETURNING *`,
            [
                staffId,
                data.wages_enabled ?? false,
                data.compensation_type ?? "none",
                data.hourly_rate ?? null,
                data.salary_amount ?? null,
                data.location_restriction ?? "workspace_default",
                data.auto_clock_in ?? "workspace_default",
                data.auto_clock_out ?? "workspace_default",
                data.automated_breaks ?? "workspace_default",
            ]
        );
        return rows[0];
    },
};

// ─── Commissions ──────────────────────────────────────────────────────────────

export const staffCommissionsRepository = {
    async listByStaffId(staffId: string): Promise<StaffCommissionSettings[]> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_commission_settings WHERE staff_id = $1 ORDER BY category`, [staffId]
        );
        return rows;
    },

    // ── NEW: fetch all commissions for every staff in a salon — single JOIN query ──
    async listBySalonId(salonId: string): Promise<(StaffCommissionSettings & {
        staff_first_name: string;
        staff_last_name: string | null;
        staff_email: string;
        staff_calendar_color: string | null;
        staff_designation: string | null;
    })[]> {
        if (!salonId) throw new Error("listBySalonId: salonId is required");
        const { rows } = await pool.query(
            `SELECT
                sc.*,
                s.first_name  AS staff_first_name,
                s.last_name   AS staff_last_name,
                s.email       AS staff_email,
                s.calendar_color AS staff_calendar_color,
                s.designation AS staff_designation
             FROM staff_commission_settings sc
             JOIN staff s ON s.id = sc.staff_id
             WHERE s.salon_id = $1
               AND s.is_active = true
             ORDER BY s.first_name, sc.category`,
            [salonId]
        );
        return rows;
    },

    async findByCategory(staffId: string, category: CommissionCategory): Promise<StaffCommissionSettings | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_commission_settings WHERE staff_id = $1 AND category = $2`, [staffId, category]
        );
        return rows[0] || null;
    },

    async upsert(staffId: string, data: UpdateCommissionBody): Promise<StaffCommissionSettings> {
        const { rows } = await pool.query(
            `INSERT INTO staff_commission_settings (
                staff_id, category, is_enabled, commission_kind, default_rate, revenue_target,
                use_default_calculation, pass_cancellation_fee_late, pass_cancellation_fee_noshow
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            ON CONFLICT (staff_id, category) DO UPDATE SET
                is_enabled               = EXCLUDED.is_enabled,
                commission_kind          = EXCLUDED.commission_kind,
                default_rate             = EXCLUDED.default_rate,
                revenue_target           = EXCLUDED.revenue_target,
                use_default_calculation  = EXCLUDED.use_default_calculation,
                pass_cancellation_fee_late   = EXCLUDED.pass_cancellation_fee_late,
                pass_cancellation_fee_noshow = EXCLUDED.pass_cancellation_fee_noshow,
                updated_at = NOW()
            RETURNING *`,
            [
                staffId, data.category,
                data.is_enabled         ?? false,
                data.commission_kind    ?? "percentage",
                data.default_rate       ?? 0,
                data.revenue_target     ?? 0,
                data.use_default_calculation     ?? true,
                data.pass_cancellation_fee_late  ?? false,
                data.pass_cancellation_fee_noshow ?? false,
            ]
        );
        return rows[0];
    },
};


// ─── Commission Slabs ─────────────────────────────────────────────────────────

export const commissionSlabsRepository = {
    async listByStaffAndCategory(staffId: string, category: string) {
        const { rows } = await pool.query(
            `SELECT * FROM commission_slabs
             WHERE staff_id = $1 AND category = $2 AND is_enabled = true
             ORDER BY revenue_target ASC`,
            [staffId, category]
        );
        return rows;
    },

    async listByStaff(staffId: string) {
        const { rows } = await pool.query(
            `SELECT * FROM commission_slabs WHERE staff_id = $1 AND is_enabled = true
             ORDER BY category, revenue_target ASC`,
            [staffId]
        );
        return rows;
    },

    async replaceForStaffAndCategory(
        staffId: string,
        salonId: string,
        category: string,
        slabs: { revenue_target: number; commission_kind: string; commission_value: number }[]
    ) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Delete existing slabs for this staff + category
            await client.query(
                `DELETE FROM commission_slabs WHERE staff_id = $1 AND category = $2`,
                [staffId, category]
            );
            // Insert new slabs
            const results = [];
            for (const slab of slabs) {
                if (!slab.revenue_target && !slab.commission_value) continue;
                const { rows } = await client.query(
                    `INSERT INTO commission_slabs
                        (staff_id, salon_id, category, revenue_target, commission_kind, commission_value, is_enabled)
                     VALUES ($1,$2,$3,$4,$5,$6,true)
                     RETURNING *`,
                    [staffId, salonId, category, slab.revenue_target, slab.commission_kind, slab.commission_value]
                );
                results.push(rows[0]);
            }
            await client.query('COMMIT');
            return results;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    },

    async deleteByStaffAndCategory(staffId: string, category: string) {
        await pool.query(
            `DELETE FROM commission_slabs WHERE staff_id = $1 AND category = $2`,
            [staffId, category]
        );
    },
};

// ─── Commission History ───────────────────────────────────────────────────────

export const commissionHistoryRepository = {
    async listByStaff(staffId: string, month?: string) {
        const dateFilter = month
            ? `AND date_trunc('month', ce.earned_at) = date_trunc('month', ($2 || '-01')::date)`
            : '';
        const params: any[] = [staffId];
        if (month) params.push(month);
        const { rows } = await pool.query(
            `SELECT
                ce.*,
                s.name AS service_name
             FROM commission_earned ce
             LEFT JOIN sales sa ON sa.id = ce.sale_id
             WHERE ce.staff_id = $1 ${dateFilter}
             ORDER BY ce.earned_at DESC`,
            params
        );
        return rows;
    },

    async exportBySalon(salonId: string, month?: string) {
        const dateFilter = month
            ? `AND date_trunc('month', ce.earned_at) = date_trunc('month', ($2 || '-01')::date)`
            : '';
        const params: any[] = [salonId];
        if (month) params.push(month);
        const { rows } = await pool.query(
            `SELECT
                s.first_name || ' ' || COALESCE(s.last_name,'') AS staff_name,
                ce.category,
                ce.revenue_amount,
                ce.commission_kind,
                ce.commission_rate,
                ce.commission_amount,
                ce.status,
                ce.earned_at::date AS earned_date
             FROM commission_earned ce
             JOIN staff s ON s.id = ce.staff_id
             WHERE ce.salon_id = $1 ${dateFilter}
             ORDER BY s.first_name, ce.earned_at DESC`,
            params
        );
        return rows;
    },
};

// ─── Pay Runs ─────────────────────────────────────────────────────────────────

export const staffPayRunsRepository = {
    async findByStaffId(staffId: string): Promise<StaffPayRunSettings | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_pay_run_settings WHERE staff_id = $1`, [staffId]
        );
        return rows[0] || null;
    },

    async upsert(staffId: string, data: UpdatePayRunBody): Promise<StaffPayRunSettings> {
        const { rows } = await pool.query(
            `INSERT INTO staff_pay_run_settings (
                staff_id, pay_runs_enabled, payment_method, calculation_type,
                deduct_payment_processing_fees, deduct_new_client_fees, record_cash_advances
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (staff_id) DO UPDATE SET
                pay_runs_enabled = EXCLUDED.pay_runs_enabled,
                payment_method = EXCLUDED.payment_method,
                calculation_type = EXCLUDED.calculation_type,
                deduct_payment_processing_fees = EXCLUDED.deduct_payment_processing_fees,
                deduct_new_client_fees = EXCLUDED.deduct_new_client_fees,
                record_cash_advances = EXCLUDED.record_cash_advances,
                updated_at = NOW()
            RETURNING *`,
            [
                staffId,
                data.pay_runs_enabled ?? false,
                data.payment_method ?? "pay_manually",
                data.calculation_type ?? "automatic",
                data.deduct_payment_processing_fees ?? false,
                data.deduct_new_client_fees ?? false,
                data.record_cash_advances ?? false,
            ]
        );
        return rows[0];
    },
};

// ─── Schedules ────────────────────────────────────────────────────────────────

export const staffSchedulesRepository = {
    async listByStaffId(staffId: string, start?: string, end?: string): Promise<StaffSchedule[]> {
        if (start && end) {
            const { rows } = await pool.query(
                `SELECT * FROM staff_schedules WHERE staff_id = $1 AND date >= $2::date AND date <= $3::date ORDER BY date ASC, day_of_week ASC`,
                [staffId, start, end]
            );
            return rows;
        }
        const { rows } = await pool.query(
            `SELECT * FROM staff_schedules WHERE staff_id = $1 ORDER BY date ASC, day_of_week ASC`, [staffId]
        );
        return rows;
    },

    async deleteByDate(staffId: string, date: string): Promise<void> {
        await pool.query(`DELETE FROM staff_schedules WHERE staff_id = $1 AND date = $2::date`, [staffId, date]);
    },

    async deleteByDay(staffId: string, dayOfWeek: number): Promise<void> {
        await pool.query(`DELETE FROM staff_schedules WHERE staff_id = $1 AND day_of_week = $2`, [staffId, dayOfWeek]);
    },

    async upsertBulk(staffId: string, body: UpsertStaffSchedulesBody): Promise<StaffSchedule[]> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const results: StaffSchedule[] = [];

            for (const item of body.items) {
                const conflictColumns = item.date ? '(staff_id, date)' : '(staff_id, day_of_week) WHERE (date IS NULL)';
                const insertColumns = item.date
                    ? `staff_id, day_of_week, is_available, start_time, end_time, notes, date`
                    : `staff_id, day_of_week, is_available, start_time, end_time, notes`;
                const valuesPlaceholders = item.date ? `$1,$2,$3,$4,$5,$6,$7` : `$1,$2,$3,$4,$5,$6`;
                const updateSet = `
                    is_available = EXCLUDED.is_available,
                    start_time   = EXCLUDED.start_time,
                    end_time     = EXCLUDED.end_time,
                    notes        = EXCLUDED.notes,
                    day_of_week  = EXCLUDED.day_of_week,
                    ${item.date ? 'date = EXCLUDED.date,' : ''}
                    updated_at   = NOW()`;
                const query = `INSERT INTO staff_schedules (${insertColumns})
                    VALUES (${valuesPlaceholders})
                    ON CONFLICT ${conflictColumns} DO UPDATE SET ${updateSet}
                    RETURNING *`;
                const params = item.date
                    ? [staffId, item.day_of_week, item.is_available,
                        item.is_available ? (item.start_time ?? null) : null,
                        item.is_available ? (item.end_time ?? null) : null,
                        item.notes ?? null, item.date ?? null]
                    : [staffId, item.day_of_week, item.is_available,
                        item.is_available ? (item.start_time ?? null) : null,
                        item.is_available ? (item.end_time ?? null) : null,
                        item.notes ?? null];
                const { rows } = await client.query(query, params);
                results.push(rows[0]);
            }

            await client.query("COMMIT");
            return results;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};