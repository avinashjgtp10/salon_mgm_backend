"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffSchedulesRepository = exports.staffPayRunsRepository = exports.staffCommissionsRepository = exports.staffWagesRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
// ─── Wages ────────────────────────────────────────────────────────────────────
exports.staffWagesRepository = {
    async findByStaffId(staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_wage_settings WHERE staff_id = $1`, [staffId]);
        return rows[0] || null;
    },
    async upsert(staffId, data) {
        const existing = await this.findByStaffId(staffId);
        if (!existing) {
            const { rows } = await database_1.default.query(`INSERT INTO staff_wage_settings
           (staff_id, wages_enabled, compensation_type, hourly_rate, salary_amount,
            location_restriction, auto_clock_in, auto_clock_out, automated_breaks)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
                staffId,
                data.wages_enabled ?? false,
                data.compensation_type ?? "none",
                data.hourly_rate ?? null,
                data.salary_amount ?? null,
                data.location_restriction ?? "workspace_default",
                data.auto_clock_in ?? "workspace_default",
                data.auto_clock_out ?? "workspace_default",
                data.automated_breaks ?? "workspace_default",
            ]);
            return rows[0];
        }
        const m = {
            wages_enabled: data.wages_enabled ?? existing.wages_enabled,
            compensation_type: data.compensation_type ?? existing.compensation_type,
            hourly_rate: data.hourly_rate !== undefined ? data.hourly_rate : existing.hourly_rate,
            salary_amount: data.salary_amount !== undefined ? data.salary_amount : existing.salary_amount,
            location_restriction: data.location_restriction ?? existing.location_restriction,
            auto_clock_in: data.auto_clock_in ?? existing.auto_clock_in,
            auto_clock_out: data.auto_clock_out ?? existing.auto_clock_out,
            automated_breaks: data.automated_breaks ?? existing.automated_breaks,
        };
        const { rows } = await database_1.default.query(`UPDATE staff_wage_settings
       SET wages_enabled=$1, compensation_type=$2, hourly_rate=$3, salary_amount=$4,
           location_restriction=$5, auto_clock_in=$6, auto_clock_out=$7, automated_breaks=$8, updated_at=NOW()
       WHERE staff_id=$9 RETURNING *`, [m.wages_enabled, m.compensation_type, m.hourly_rate, m.salary_amount,
            m.location_restriction, m.auto_clock_in, m.auto_clock_out, m.automated_breaks, staffId]);
        return rows[0];
    },
};
// ─── Commissions ──────────────────────────────────────────────────────────────
exports.staffCommissionsRepository = {
    async listByStaffId(staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_commission_settings WHERE staff_id = $1 ORDER BY category`, [staffId]);
        return rows;
    },
    async findByCategory(staffId, category) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_commission_settings WHERE staff_id = $1 AND category = $2`, [staffId, category]);
        return rows[0] || null;
    },
    async upsert(staffId, data) {
        const existing = await this.findByCategory(staffId, data.category);
        if (!existing) {
            const { rows } = await database_1.default.query(`INSERT INTO staff_commission_settings
           (staff_id, category, is_enabled, commission_kind, default_rate,
            use_default_calculation, pass_cancellation_fee_late, pass_cancellation_fee_noshow)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
                staffId, data.category,
                data.is_enabled ?? false,
                data.commission_kind ?? "percentage",
                data.default_rate ?? 0,
                data.use_default_calculation ?? true,
                data.pass_cancellation_fee_late ?? false,
                data.pass_cancellation_fee_noshow ?? false,
            ]);
            return rows[0];
        }
        const m = {
            is_enabled: data.is_enabled ?? existing.is_enabled,
            commission_kind: data.commission_kind ?? existing.commission_kind,
            default_rate: data.default_rate ?? existing.default_rate,
            use_default_calculation: data.use_default_calculation ?? existing.use_default_calculation,
            pass_cancellation_fee_late: data.pass_cancellation_fee_late ?? existing.pass_cancellation_fee_late,
            pass_cancellation_fee_noshow: data.pass_cancellation_fee_noshow ?? existing.pass_cancellation_fee_noshow,
        };
        const { rows } = await database_1.default.query(`UPDATE staff_commission_settings
       SET is_enabled=$1, commission_kind=$2, default_rate=$3,
           use_default_calculation=$4, pass_cancellation_fee_late=$5,
           pass_cancellation_fee_noshow=$6, updated_at=NOW()
       WHERE staff_id=$7 AND category=$8 RETURNING *`, [m.is_enabled, m.commission_kind, m.default_rate, m.use_default_calculation,
            m.pass_cancellation_fee_late, m.pass_cancellation_fee_noshow, staffId, data.category]);
        return rows[0];
    },
};
// ─── Pay Runs ─────────────────────────────────────────────────────────────────
exports.staffPayRunsRepository = {
    async findByStaffId(staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_pay_run_settings WHERE staff_id = $1`, [staffId]);
        return rows[0] || null;
    },
    async upsert(staffId, data) {
        const existing = await this.findByStaffId(staffId);
        if (!existing) {
            const { rows } = await database_1.default.query(`INSERT INTO staff_pay_run_settings
           (staff_id, pay_runs_enabled, payment_method, calculation_type,
            deduct_payment_processing_fees, deduct_new_client_fees, record_cash_advances)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
                staffId,
                data.pay_runs_enabled ?? false,
                data.payment_method ?? "pay_manually",
                data.calculation_type ?? "automatic",
                data.deduct_payment_processing_fees ?? false,
                data.deduct_new_client_fees ?? false,
                data.record_cash_advances ?? false,
            ]);
            return rows[0];
        }
        const m = {
            pay_runs_enabled: data.pay_runs_enabled ?? existing.pay_runs_enabled,
            payment_method: data.payment_method ?? existing.payment_method,
            calculation_type: data.calculation_type ?? existing.calculation_type,
            deduct_payment_processing_fees: data.deduct_payment_processing_fees ?? existing.deduct_payment_processing_fees,
            deduct_new_client_fees: data.deduct_new_client_fees ?? existing.deduct_new_client_fees,
            record_cash_advances: data.record_cash_advances ?? existing.record_cash_advances,
        };
        const { rows } = await database_1.default.query(`UPDATE staff_pay_run_settings
       SET pay_runs_enabled=$1, payment_method=$2, calculation_type=$3,
           deduct_payment_processing_fees=$4, deduct_new_client_fees=$5,
           record_cash_advances=$6, updated_at=NOW()
       WHERE staff_id=$7 RETURNING *`, [m.pay_runs_enabled, m.payment_method, m.calculation_type,
            m.deduct_payment_processing_fees, m.deduct_new_client_fees, m.record_cash_advances, staffId]);
        return rows[0];
    },
};
// ─── Schedules ────────────────────────────────────────────────────────────────
exports.staffSchedulesRepository = {
    async listByStaffId(staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_schedules WHERE staff_id = $1 ORDER BY day_of_week`, [staffId]);
        return rows;
    },
    async upsertBulk(staffId, body) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            const results = [];
            for (const item of body.items) {
                const { rows } = await client.query(`INSERT INTO staff_schedules (staff_id, day_of_week, is_available, start_time, end_time, notes)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (staff_id, day_of_week) DO UPDATE SET
             is_available = EXCLUDED.is_available,
             start_time   = EXCLUDED.start_time,
             end_time     = EXCLUDED.end_time,
             notes        = EXCLUDED.notes,
             updated_at   = NOW()
           RETURNING *`, [
                    staffId, item.day_of_week, item.is_available,
                    item.is_available ? (item.start_time ?? null) : null,
                    item.is_available ? (item.end_time ?? null) : null,
                    item.notes ?? null,
                ]);
                results.push(rows[0]);
            }
            await client.query("COMMIT");
            return results;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
};
//# sourceMappingURL=staffSettings.repository.js.map