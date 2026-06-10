import pool from "../../config/database";
import {
    CreateStaffAddressBody,
    CreateStaffBody,
    CreateEmergencyContactBody,
    CreateStaffLeaveBody,
    Staff,
    StaffAddress,
    StaffEmergencyContact,
    StaffLeave,
    StaffListQuery,
    UpdateStaffAddressBody,
    UpdateStaffBody,
    UpdateEmergencyContactBody,
    UpdateStaffLeaveBody,
} from "./staff.types";

// ─── Staff ────────────────────────────────────────────────────────────────────

export const staffRepository = {
    async findById(id: string, salonId: string): Promise<Staff | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async list(salonId: string, q: StaffListQuery): Promise<{ data: Staff[]; total: number }> {
        const {
            page = 1, limit = 20, search, invitation_status,
            employment_type, is_active, branch_id,
            sort_by = "created_at", sort_order = "DESC",
        } = q;

        const ALLOWED_SORT = ["first_name", "last_name", "email", "created_at", "invitation_status", "designation"];
        const safeSortBy = ALLOWED_SORT.includes(sort_by) ? sort_by : "created_at";
        const safeSortOrder = sort_order === "ASC" ? "ASC" : "DESC";

        const conditions: string[] = ["salon_id = $1"];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (search) {
            conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
            values.push(`%${search}%`);
            idx++;
        }
        if (invitation_status) { conditions.push(`invitation_status = $${idx}`); values.push(invitation_status); idx++; }
        if (employment_type) { conditions.push(`employment_type = $${idx}`); values.push(employment_type); idx++; }
        if (is_active !== undefined) { conditions.push(`is_active = $${idx}`); values.push(is_active); idx++; }
        if (branch_id) { conditions.push(`branch_id = $${idx}`); values.push(branch_id); idx++; }

        const where = conditions.join(" AND ");
        const offset = (page - 1) * limit;

        const [{ rows: data }, { rows: countRows }] = await Promise.all([
            pool.query(
                `SELECT * FROM staff WHERE ${where} ORDER BY ${safeSortBy} ${safeSortOrder} LIMIT $${idx} OFFSET $${idx + 1}`,
                [...values, limit, offset]
            ),
            pool.query(`SELECT COUNT(*)::int AS total FROM staff WHERE ${where}`, values),
        ]);

        return { data, total: countRows[0].total };
    },

    async findByEmail(salonId: string, email: string): Promise<Staff | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff WHERE salon_id = $1 AND email = $2`,
            [salonId, email]
        );
        return rows[0] || null;
    },

    async create(salonId: string, data: CreateStaffBody, passwordHash?: string | null): Promise<Staff> {
        try {
            console.log("[DB DEBUG] staffRepository.create - SQL params:", [
                salonId, data.first_name, data.last_name ?? null, data.email,
                data.phone ?? null, data.phone_country_code ?? null,
                data.additional_phone ?? null, data.country ?? null,
                data.calendar_color ?? "blue", data.job_title ?? null,
                data.staff_external_id ?? null, data.employment_type ?? null,
                data.branch_id ?? null, data.employee_code ?? null,
                data.experience_years ?? null, data.specialization ?? [],
            ]);

            const { rows } = await pool.query(
                `INSERT INTO staff (
            salon_id, first_name, last_name, email, phone, phone_country_code,
            additional_phone, country, calendar_color, designation,
            staff_external_id, employment_type, branch_id, employee_code,
              experience_years, specialization, password_hash,
              allow_calendar_bookings,
              is_active, invitation_status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,false,'pending')
            RETURNING *`,
                [
                    salonId, data.first_name, data.last_name ?? null, data.email,
                    data.phone ?? null, data.phone_country_code ?? null,
                    data.additional_phone ?? null, data.country ?? null,
                    data.calendar_color ?? "blue", data.job_title ?? null,
                    data.staff_external_id ?? null, data.employment_type ?? null,
                    data.branch_id ?? null, data.employee_code ?? null,
                    data.experience_years ?? null, data.specialization ?? [],
                    passwordHash ?? null,
                    data.allow_calendar_bookings ?? true,
                ]
            );
            return rows[0];
        } catch (error) {
            console.error("[DB DEBUG] staffRepository.create - DATABASE ERROR:", error);
            throw error;
        }
    },

    async updateDateFields(id: string, salonId: string, data: {
        joined_date?: string | null;
        birthday_day?: number | null;
        birthday_month?: number | null;
    }): Promise<void> {
        await pool.query(
            `UPDATE staff SET joined_date = $1, birthday_day = $2, birthday_month = $3 WHERE id = $4 AND salon_id = $5`,
            [data.joined_date ?? null, data.birthday_day ?? null, data.birthday_month ?? null, id, salonId]
        );
    },

    async update(id: string, salonId: string, patch: UpdateStaffBody, passwordHash?: string | null): Promise<Staff> {
        // Maps UpdateStaffBody keys to actual DB column names (job_title → designation)
        // 'password' is excluded here — handled via the passwordHash param
        const COLUMN_MAP: Record<string, string> = {
            first_name: "first_name",
            email: "email",
            last_name: "last_name",
            phone: "phone",
            phone_country_code: "phone_country_code",
            additional_phone: "additional_phone",
            country: "country",
            calendar_color: "calendar_color",
            job_title: "designation",
            staff_external_id: "staff_external_id",
            employment_type: "employment_type",
            branch_id: "branch_id",
            employee_code: "employee_code",
            experience_years: "experience_years",
            specialization: "specialization",
            allow_calendar_bookings: "allow_calendar_bookings",
            custom_permissions: "custom_permissions",
        };

        const entries = (Object.keys(patch) as (keyof UpdateStaffBody)[])
            .filter((k) => k in COLUMN_MAP)
            .map((k) => [COLUMN_MAP[k as string], (patch as any)[k]] as [string, unknown]);

        if (passwordHash !== undefined && passwordHash !== null) {
            entries.push(["password_hash", passwordHash]);
        }

        if (entries.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM staff WHERE id = $1 AND salon_id = $2`, [id, salonId]);
            return rows[0];
        }

        const setParts = entries.map(([col], i) => `${col} = $${i + 1}`);
        const values: unknown[] = entries.map(([, val]) => val);
        setParts.push(`updated_at = NOW()`);
        values.push(id, salonId);

        const { rows } = await pool.query(
            `UPDATE staff SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING *`,
            values
        );
        return rows[0];
    },

    async activateDirectly(id: string): Promise<void> {
        await pool.query(
            `UPDATE staff SET is_active = true, invitation_status = 'accepted', invitation_accepted_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [id]
        );
    },

    async deactivate(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `UPDATE staff SET is_active = false, updated_at = NOW() WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM staff WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },

    async exportForDownload(salonId: string, q: Omit<StaffListQuery, "page" | "limit">): Promise<Record<string, unknown>[]> {
        const {
            search, invitation_status, employment_type, is_active, branch_id,
            sort_by = "first_name", sort_order = "ASC",
        } = q;

        const ALLOWED_SORT = ["first_name", "last_name", "email", "created_at", "invitation_status", "designation"];
        const safeSortBy = ALLOWED_SORT.includes(sort_by ?? "") ? sort_by : "first_name";
        const safeSortOrder = sort_order === "DESC" ? "DESC" : "ASC";

        const conditions: string[] = ["salon_id = $1"];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (search) {
            conditions.push(`(first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR email ILIKE $${idx})`);
            values.push(`%${search}%`);
            idx++;
        }
        if (invitation_status) { conditions.push(`invitation_status = $${idx}`); values.push(invitation_status); idx++; }
        if (employment_type) { conditions.push(`employment_type = $${idx}`); values.push(employment_type); idx++; }
        if (is_active !== undefined) { conditions.push(`is_active = $${idx}`); values.push(is_active); idx++; }
        if (branch_id) { conditions.push(`branch_id = $${idx}`); values.push(branch_id); idx++; }

        const where = conditions.join(" AND ");

        const { rows } = await pool.query(
            `SELECT
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
             ORDER BY ${safeSortBy} ${safeSortOrder}`,
            values
        );
        return rows;
    },

    async linkUserToStaff(staffId: string, userId: string, firstName: string, lastName?: string): Promise<void> {
        await pool.query(
            `UPDATE staff SET user_id = $1, first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), updated_at = NOW() WHERE id = $4`,
            [userId, firstName, lastName || null, staffId]
        );
    },
};

// ─── Address ──────────────────────────────────────────────────────────────────

export const staffAddressRepository = {
    async listByStaffId(staffId: string): Promise<StaffAddress[]> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_addresses WHERE staff_id = $1 ORDER BY created_at DESC`, [staffId]
        );
        return rows;
    },

    async findById(id: string, staffId: string): Promise<StaffAddress | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_addresses WHERE id = $1 AND staff_id = $2`, [id, staffId]
        );
        return rows[0] || null;
    },

    async create(staffId: string, data: CreateStaffAddressBody): Promise<StaffAddress> {
        const { rows } = await pool.query(
            `INSERT INTO staff_addresses (staff_id, address_name, address) VALUES ($1,$2,$3) RETURNING *`,
            [staffId, data.address_name, data.address]
        );
        return rows[0];
    },

    async update(id: string, staffId: string, patch: UpdateStaffAddressBody): Promise<StaffAddress | null> {
        const keys = Object.keys(patch) as (keyof UpdateStaffAddressBody)[];
        if (keys.length === 0) return this.findById(id, staffId);

        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push((patch as any)[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id, staffId);

        const { rows } = await pool.query(
            `UPDATE staff_addresses SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND staff_id = $${values.length} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async delete(id: string, staffId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM staff_addresses WHERE id = $1 AND staff_id = $2`, [id, staffId]
        );
        return (rowCount ?? 0) > 0;
    },
};

// ─── Emergency Contact ────────────────────────────────────────────────────────

export const staffEmergencyContactRepository = {
    async listByStaffId(staffId: string): Promise<StaffEmergencyContact[]> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_emergency_contacts WHERE staff_id = $1 ORDER BY created_at DESC`, [staffId]
        );
        return rows;
    },

    async findById(id: string, staffId: string): Promise<StaffEmergencyContact | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_emergency_contacts WHERE id = $1 AND staff_id = $2`, [id, staffId]
        );
        return rows[0] || null;
    },

    async create(staffId: string, data: CreateEmergencyContactBody): Promise<StaffEmergencyContact> {
        const { rows } = await pool.query(
            `INSERT INTO staff_emergency_contacts (staff_id, full_name, relationship, email, phone_country_code, phone_number)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [staffId, data.full_name, data.relationship, data.email ?? null, data.phone_country_code ?? null, data.phone_number]
        );
        return rows[0];
    },

    async update(id: string, staffId: string, patch: UpdateEmergencyContactBody): Promise<StaffEmergencyContact | null> {
        const keys = Object.keys(patch) as (keyof UpdateEmergencyContactBody)[];
        if (keys.length === 0) return this.findById(id, staffId);

        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push((patch as any)[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id, staffId);

        const { rows } = await pool.query(
            `UPDATE staff_emergency_contacts SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND staff_id = $${values.length} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async delete(id: string, staffId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM staff_emergency_contacts WHERE id = $1 AND staff_id = $2`, [id, staffId]
        );
        return (rowCount ?? 0) > 0;
    },
};

// ─── Leaves ───────────────────────────────────────────────────────────────────

export const staffLeavesRepository = {
    async listByStaffId(staffId: string, from?: string, to?: string): Promise<StaffLeave[]> {
        const conditions = ["staff_id = $1"];
        const values: unknown[] = [staffId];
        let idx = 2;

        if (from) { conditions.push(`end_date >= $${idx}`); values.push(from); idx++; }
        if (to) { conditions.push(`start_date <= $${idx}`); values.push(to); idx++; }

        const { rows } = await pool.query(
            `SELECT * FROM staff_leaves WHERE ${conditions.join(" AND ")} ORDER BY start_date DESC`, values
        );
        return rows;
    },

    async findById(id: string, staffId: string): Promise<StaffLeave | null> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_leaves WHERE id = $1 AND staff_id = $2`, [id, staffId]
        );
        return rows[0] || null;
    },

    async create(staffId: string, data: CreateStaffLeaveBody): Promise<StaffLeave> {
        const { rows } = await pool.query(
            `INSERT INTO staff_leaves (staff_id, start_date, end_date, leave_type, status, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [staffId, data.start_date, data.end_date, data.leave_type, data.status ?? "pending", data.reason ?? null]
        );
        return rows[0];
    },

    async update(id: string, staffId: string, patch: UpdateStaffLeaveBody): Promise<StaffLeave | null> {
        const keys = Object.keys(patch) as (keyof UpdateStaffLeaveBody)[];
        if (keys.length === 0) return this.findById(id, staffId);

        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${k} = $${i + 1}`); values.push((patch as any)[k]); });
        values.push(id, staffId);

        const { rows } = await pool.query(
            `UPDATE staff_leaves SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND staff_id = $${values.length} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async delete(id: string, staffId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM staff_leaves WHERE id = $1 AND staff_id = $2`, [id, staffId]
        );
        return (rowCount ?? 0) > 0;
    },
};
