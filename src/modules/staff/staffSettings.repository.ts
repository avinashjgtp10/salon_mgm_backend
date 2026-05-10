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

    async findByCategory(staffId: string, category: CommissionCategory): Promise<StaffCommissionSettings | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_commission_settings WHERE staff_id = $1 AND category = $2`, [staffId, category]
        );
        return rows[0] || null;
    },

    async upsert(staffId: string, data: UpdateCommissionBody): Promise<StaffCommissionSettings> {
        const { rows } = await pool.query(
            `INSERT INTO staff_commission_settings (
                staff_id, category, is_enabled, commission_kind, default_rate,
                use_default_calculation, pass_cancellation_fee_late, pass_cancellation_fee_noshow
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (staff_id, category) DO UPDATE SET
                is_enabled = EXCLUDED.is_enabled,
                commission_kind = EXCLUDED.commission_kind,
                default_rate = EXCLUDED.default_rate,
                use_default_calculation = EXCLUDED.use_default_calculation,
                pass_cancellation_fee_late = EXCLUDED.pass_cancellation_fee_late,
                pass_cancellation_fee_noshow = EXCLUDED.pass_cancellation_fee_noshow,
                updated_at = NOW()
            RETURNING *`,
            [
                staffId, data.category,
                data.is_enabled ?? false,
                data.commission_kind ?? "percentage",
                data.default_rate ?? 0,
                data.use_default_calculation ?? true,
                data.pass_cancellation_fee_late ?? false,
                data.pass_cancellation_fee_noshow ?? false,
            ]
        );
        return rows[0];
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
    async listByStaffId(staffId: string): Promise<StaffSchedule[]> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_schedules WHERE staff_id = $1 ORDER BY day_of_week`, [staffId]
        );
        return rows;
    },

    async upsertBulk(staffId: string, body: UpsertStaffSchedulesBody): Promise<StaffSchedule[]> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const results: StaffSchedule[] = [];

            for (const item of body.items) {
                const { rows } = await client.query(
                    `INSERT INTO staff_schedules (staff_id, day_of_week, is_available, start_time, end_time, notes)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (staff_id, day_of_week) DO UPDATE SET
             is_available = EXCLUDED.is_available,
             start_time   = EXCLUDED.start_time,
             end_time     = EXCLUDED.end_time,
             notes        = EXCLUDED.notes,
             updated_at   = NOW()
           RETURNING *`,
                    [
                        staffId, item.day_of_week, item.is_available,
                        item.is_available ? (item.start_time ?? null) : null,
                        item.is_available ? (item.end_time ?? null) : null,
                        item.notes ?? null,
                    ]
                );
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
