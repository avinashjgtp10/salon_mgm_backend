"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentsRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.appointmentsRepository = {
    async findById(id) {
        const { rows } = await database_1.default.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
        return rows[0] || null;
    },
    async listBySalonId(salonId, filters) {
        const conditions = [`salon_id = $1`];
        const values = [salonId];
        let idx = 2;
        if (filters.date) {
            conditions.push(`DATE(scheduled_at) = $${idx}::date`);
            values.push(filters.date);
            idx++;
        }
        if (filters.staff_id) {
            conditions.push(`staff_id = $${idx}`);
            values.push(filters.staff_id);
            idx++;
        }
        if (filters.status) {
            conditions.push(`status = $${idx}`);
            values.push(filters.status);
            idx++;
        }
        const { rows } = await database_1.default.query(`SELECT * FROM appointments WHERE ${conditions.join(" AND ")} ORDER BY scheduled_at ASC`, values);
        return rows;
    },
    async listByClientId(clientId) {
        const { rows } = await database_1.default.query(`SELECT * FROM appointments WHERE client_id = $1 ORDER BY scheduled_at DESC`, [clientId]);
        return rows;
    },
    async hasConflict(params) {
        const { staffId, scheduledAt, durationMinutes, excludeId } = params;
        const query = `
            SELECT 1 FROM appointments
            WHERE staff_id = $1
              AND status NOT IN ('cancelled', 'no_show')
              AND scheduled_at < ($2::timestamptz + ($3 * interval '1 minute'))
              AND (scheduled_at + (duration_minutes * interval '1 minute')) > $2::timestamptz
              ${excludeId ? `AND id != $4` : ""}
            LIMIT 1
        `;
        const values = [staffId, scheduledAt, durationMinutes];
        if (excludeId)
            values.push(excludeId);
        const { rows } = await database_1.default.query(query, values);
        return rows.length > 0;
    },
    async create(data, createdBy) {
        const { rows } = await database_1.default.query(`INSERT INTO appointments (
      salon_id, branch_id, client_id, staff_id, service_id,
      title, notes, status,
      scheduled_at, duration_minutes,
      ends_at,
      colour, created_by
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, 'booked',
      $8, $9,
      ($8::timestamptz + ($9::integer * INTERVAL '1 minute')),
      $10, $11
    )
    RETURNING *`, [
            data.salon_id,
            data.branch_id ?? null,
            data.client_id ?? null,
            data.staff_id ?? null,
            data.service_id ?? null,
            data.title ?? "Appointment",
            data.notes ?? null,
            data.scheduled_at,
            data.duration_minutes,
            data.colour ?? null,
            createdBy,
        ]);
        return rows[0];
    },
    async update(id, patch) {
        const keys = Object.keys(patch);
        if (keys.length === 0) {
            const { rows } = await database_1.default.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
            return rows[0];
        }
        const setParts = [];
        const values = [];
        keys.forEach((k, idx) => {
            setParts.push(`${String(k)} = $${idx + 1}`);
            values.push(patch[k]);
        });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        const { rows } = await database_1.default.query(`UPDATE appointments SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
        return rows[0];
    },
    async updateStatus(id, status) {
        const { rows } = await database_1.default.query(`UPDATE appointments SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, status]);
        return rows[0];
    },
    async linkSale(id, saleId) {
        const { rows } = await database_1.default.query(`UPDATE appointments SET sale_id = $2, status = 'completed', updated_at = NOW()
             WHERE id = $1 RETURNING *`, [id, saleId]);
        return rows[0];
    },
    async exportList(filters) {
        const conditions = [];
        const values = [];
        let idx = 1;
        if (filters.salon_id) {
            conditions.push(`salon_id = $${idx}`);
            values.push(filters.salon_id);
            idx++;
        }
        if (filters.status) {
            conditions.push(`status = $${idx}`);
            values.push(filters.status);
            idx++;
        }
        if (filters.start_date) {
            conditions.push(`scheduled_at >= $${idx}::date`);
            values.push(filters.start_date);
            idx++;
        }
        if (filters.end_date) {
            conditions.push(`scheduled_at < ($${idx}::date + INTERVAL '1 day')`);
            values.push(filters.end_date);
            idx++;
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const { rows } = await database_1.default.query(`SELECT * FROM appointments ${where} ORDER BY scheduled_at DESC`, values);
        return rows;
    },
};
//# sourceMappingURL=appointments.repository.js.map