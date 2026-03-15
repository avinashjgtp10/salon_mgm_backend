"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffLeavesRepository = exports.staffEmergencyContactRepository = exports.staffAddressRepository = exports.staffRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
// ─── Staff ────────────────────────────────────────────────────────────────────
exports.staffRepository = {
    async findById(id, salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },
    async list(salonId, q) {
        const { page = 1, limit = 20, search, invitation_status, employment_type, is_active, branch_id, sort_by = "created_at", sort_order = "DESC", } = q;
        const ALLOWED_SORT = ["first_name", "last_name", "email", "created_at", "invitation_status", "designation"];
        const safeSortBy = ALLOWED_SORT.includes(sort_by) ? sort_by : "created_at";
        const safeSortOrder = sort_order === "ASC" ? "ASC" : "DESC";
        const conditions = ["salon_id = $1"];
        const values = [salonId];
        let idx = 2;
        if (search) {
            conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
            values.push(`%${search}%`);
            idx++;
        }
        if (invitation_status) {
            conditions.push(`invitation_status = $${idx}`);
            values.push(invitation_status);
            idx++;
        }
        if (employment_type) {
            conditions.push(`employment_type = $${idx}`);
            values.push(employment_type);
            idx++;
        }
        if (is_active !== undefined) {
            conditions.push(`is_active = $${idx}`);
            values.push(is_active);
            idx++;
        }
        if (branch_id) {
            conditions.push(`branch_id = $${idx}`);
            values.push(branch_id);
            idx++;
        }
        const where = conditions.join(" AND ");
        const offset = (page - 1) * limit;
        const [{ rows: data }, { rows: countRows }] = await Promise.all([
            database_1.default.query(`SELECT * FROM staff WHERE ${where} ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT $${idx} OFFSET $${idx + 1}`, [...values, limit, offset]),
            database_1.default.query(`SELECT COUNT(*)::int AS total FROM staff WHERE ${where}`, values),
        ]);
        return { data, total: countRows[0].total };
    },
    async create(salonId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO staff (
        salon_id, first_name, last_name, email, phone, phone_country_code,
        additional_phone, country, calendar_color, designation,
        staff_external_id, employment_type, branch_id, employee_code,
        experience_years, specialization, is_active, invitation_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,'pending')
      RETURNING *`, [
            salonId, data.first_name, data.last_name ?? null, data.email,
            data.phone ?? null, data.phone_country_code ?? null,
            data.additional_phone ?? null, data.country ?? null,
            data.calendar_color ?? "blue", data.job_title ?? null,
            data.staff_external_id ?? null, data.employment_type ?? null,
            data.branch_id ?? null, data.employee_code ?? null,
            data.experience_years ?? null, data.specialization ?? [],
        ]);
        return rows[0];
    },
    async update(id, salonId, patch) {
        const keys = Object.keys(patch);
        if (keys.length === 0) {
            const { rows } = await database_1.default.query(`SELECT * FROM staff WHERE id = $1 AND salon_id = $2`, [id, salonId]);
            return rows[0];
        }
        const setParts = [];
        const values = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push(patch[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id, salonId);
        const { rows } = await database_1.default.query(`UPDATE staff SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING *`, values);
        return rows[0];
    },
    async deactivate(id, salonId) {
        const { rowCount } = await database_1.default.query(`UPDATE staff SET is_active = false, updated_at = NOW() WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return (rowCount ?? 0) > 0;
    },
    async exportForDownload(salonId, q) {
        const { search, invitation_status, employment_type, is_active, branch_id, sort_by = "first_name", sort_order = "ASC", } = q;
        const ALLOWED_SORT = ["first_name", "last_name", "email", "created_at", "invitation_status", "designation"];
        const safeSortBy = ALLOWED_SORT.includes(sort_by ?? "") ? sort_by : "first_name";
        const safeSortOrder = sort_order === "DESC" ? "DESC" : "ASC";
        const conditions = ["salon_id = $1"];
        const values = [salonId];
        let idx = 2;
        if (search) {
            conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
            values.push(`%${search}%`);
            idx++;
        }
        if (invitation_status) {
            conditions.push(`invitation_status = $${idx}`);
            values.push(invitation_status);
            idx++;
        }
        if (employment_type) {
            conditions.push(`employment_type = $${idx}`);
            values.push(employment_type);
            idx++;
        }
        if (is_active !== undefined) {
            conditions.push(`is_active = $${idx}`);
            values.push(is_active);
            idx++;
        }
        if (branch_id) {
            conditions.push(`branch_id = $${idx}`);
            values.push(branch_id);
            idx++;
        }
        const where = conditions.join(" AND ");
        const { rows } = await database_1.default.query(`SELECT
                first_name,
                last_name,
                email,
                phone,
                phone_country_code,
                additional_phone,
                employee_code,
                designation,
                employment_type,
                is_active,
                invitation_status,
                branch_id,
                country,
                calendar_color,
                experience_years,
                specialization,
                commission_type,
                commission_value,
                joined_date,
                birthday_day,
                birthday_month,
                start_date_day,
                start_date_month,
                start_year,
                end_date_day,
                end_date_month,
                end_year,
                staff_external_id,
                notes,
                created_at
             FROM staff
             WHERE ${where}
             ORDER BY ${safeSortBy} ${safeSortOrder}`, values);
        return rows;
    },
};
// ─── Address ──────────────────────────────────────────────────────────────────
exports.staffAddressRepository = {
    async listByStaffId(staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_addresses WHERE staff_id = $1 ORDER BY created_at DESC`, [staffId]);
        return rows;
    },
    async findById(id, staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_addresses WHERE id = $1 AND staff_id = $2`, [id, staffId]);
        return rows[0] || null;
    },
    async create(staffId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO staff_addresses (staff_id, address_name, address) VALUES ($1,$2,$3) RETURNING *`, [staffId, data.address_name, data.address]);
        return rows[0];
    },
    async update(id, staffId, patch) {
        const keys = Object.keys(patch);
        if (keys.length === 0)
            return this.findById(id, staffId);
        const setParts = [];
        const values = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push(patch[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id, staffId);
        const { rows } = await database_1.default.query(`UPDATE staff_addresses SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND staff_id = $${values.length} RETURNING *`, values);
        return rows[0] || null;
    },
    async delete(id, staffId) {
        const { rowCount } = await database_1.default.query(`DELETE FROM staff_addresses WHERE id = $1 AND staff_id = $2`, [id, staffId]);
        return (rowCount ?? 0) > 0;
    },
};
// ─── Emergency Contact ────────────────────────────────────────────────────────
exports.staffEmergencyContactRepository = {
    async listByStaffId(staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_emergency_contacts WHERE staff_id = $1 ORDER BY created_at DESC`, [staffId]);
        return rows;
    },
    async findById(id, staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_emergency_contacts WHERE id = $1 AND staff_id = $2`, [id, staffId]);
        return rows[0] || null;
    },
    async create(staffId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO staff_emergency_contacts (staff_id, full_name, relationship, email, phone_country_code, phone_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [staffId, data.full_name, data.relationship, data.email ?? null, data.phone_country_code ?? null, data.phone_number]);
        return rows[0];
    },
    async update(id, staffId, patch) {
        const keys = Object.keys(patch);
        if (keys.length === 0)
            return this.findById(id, staffId);
        const setParts = [];
        const values = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push(patch[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id, staffId);
        const { rows } = await database_1.default.query(`UPDATE staff_emergency_contacts SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND staff_id = $${values.length} RETURNING *`, values);
        return rows[0] || null;
    },
    async delete(id, staffId) {
        const { rowCount } = await database_1.default.query(`DELETE FROM staff_emergency_contacts WHERE id = $1 AND staff_id = $2`, [id, staffId]);
        return (rowCount ?? 0) > 0;
    },
};
// ─── Leaves ───────────────────────────────────────────────────────────────────
exports.staffLeavesRepository = {
    async listByStaffId(staffId, from, to) {
        const conditions = ["staff_id = $1"];
        const values = [staffId];
        let idx = 2;
        if (from) {
            conditions.push(`end_date >= $${idx}`);
            values.push(from);
            idx++;
        }
        if (to) {
            conditions.push(`start_date <= $${idx}`);
            values.push(to);
            idx++;
        }
        const { rows } = await database_1.default.query(`SELECT * FROM staff_leaves WHERE ${conditions.join(" AND ")} ORDER BY start_date DESC`, values);
        return rows;
    },
    async findById(id, staffId) {
        const { rows } = await database_1.default.query(`SELECT * FROM staff_leaves WHERE id = $1 AND staff_id = $2`, [id, staffId]);
        return rows[0] || null;
    },
    async create(staffId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO staff_leaves (staff_id, start_date, end_date, leave_type, status, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [staffId, data.start_date, data.end_date, data.leave_type, data.status ?? "pending", data.reason ?? null]);
        return rows[0];
    },
    async update(id, staffId, patch) {
        const keys = Object.keys(patch);
        if (keys.length === 0)
            return this.findById(id, staffId);
        const setParts = [];
        const values = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push(patch[k]); });
        values.push(id, staffId);
        const { rows } = await database_1.default.query(`UPDATE staff_leaves SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND staff_id = $${values.length} RETURNING *`, values);
        return rows[0] || null;
    },
    async delete(id, staffId) {
        const { rowCount } = await database_1.default.query(`DELETE FROM staff_leaves WHERE id = $1 AND staff_id = $2`, [id, staffId]);
        return (rowCount ?? 0) > 0;
    },
};
//# sourceMappingURL=staff.repository.js.map