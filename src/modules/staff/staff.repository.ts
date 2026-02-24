import pool from "../../config/database";
import {
    CreateStaffBody,
    CreateStaffLeaveBody,
    CreateStaffScheduleBody,
    Staff,
    StaffLeave,
    StaffSchedule,
    UpdateStaffBody,
    UpdateStaffLeaveBody,
    UpdateStaffScheduleBody,
} from "./staff.types";

export const staffRepository = {
    // ---------------- STAFF ----------------
    async findById(id: string): Promise<Staff | null> {
        const { rows } = await pool.query(`SELECT * FROM staff WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async listBySalon(salonId: string): Promise<Staff[]> {
        const { rows } = await pool.query(`SELECT * FROM staff WHERE salon_id = $1 ORDER BY created_at DESC`, [salonId]);
        return rows;
    },

    async create(data: CreateStaffBody): Promise<Staff> {
        const { rows } = await pool.query(
            `INSERT INTO staff (
        user_id, salon_id, branch_id, designation, specialization,
        experience_years, commission_type, commission_value, is_active, joined_date
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
            [
                data.user_id,
                data.salon_id,
                data.branch_id ?? null,
                data.designation ?? null,
                data.specialization ?? null,
                data.experience_years ?? null,
                data.commission_type ?? null,
                data.commission_value ?? null,
                data.is_active ?? true,
                data.joined_date ?? null,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateStaffBody): Promise<Staff> {
        const keys = Object.keys(patch) as (keyof UpdateStaffBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM staff WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k, idx) => {
            setParts.push(`${String(k)} = $${idx + 1}`);
            values.push((patch as any)[k]);
        });

        setParts.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await pool.query(
            `UPDATE staff
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );

        return rows[0];
    },

    async remove(id: string): Promise<void> {
        await pool.query(`DELETE FROM staff WHERE id = $1`, [id]);
    },

    // ---------------- STAFF SCHEDULES ----------------
    async getSchedules(staffId: string): Promise<StaffSchedule[]> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_schedules WHERE staff_id = $1 ORDER BY day_of_week ASC`,
            [staffId]
        );
        return rows;
    },

    async upsertSchedule(data: CreateStaffScheduleBody): Promise<StaffSchedule> {
        const { rows } = await pool.query(
            `INSERT INTO staff_schedules (staff_id, day_of_week, start_time, end_time, is_available)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (staff_id, day_of_week)
       DO UPDATE SET
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         is_available = EXCLUDED.is_available
       RETURNING *`,
            [data.staff_id, data.day_of_week, data.start_time, data.end_time, data.is_available ?? true]
        );
        return rows[0];
    },

    async updateSchedule(id: string, patch: UpdateStaffScheduleBody): Promise<StaffSchedule> {
        const keys = Object.keys(patch) as (keyof UpdateStaffScheduleBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM staff_schedules WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k, idx) => {
            setParts.push(`${String(k)} = $${idx + 1}`);
            values.push((patch as any)[k]);
        });

        values.push(id);

        const { rows } = await pool.query(
            `UPDATE staff_schedules
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );

        return rows[0];
    },

    async removeSchedule(id: string): Promise<void> {
        await pool.query(`DELETE FROM staff_schedules WHERE id = $1`, [id]);
    },

    // ---------------- STAFF LEAVES ----------------
    async listLeaves(staffId: string): Promise<StaffLeave[]> {
        const { rows } = await pool.query(
            `SELECT * FROM staff_leaves WHERE staff_id = $1 ORDER BY start_date DESC`,
            [staffId]
        );
        return rows;
    },

    async createLeave(data: CreateStaffLeaveBody): Promise<StaffLeave> {
        const { rows } = await pool.query(
            `INSERT INTO staff_leaves (staff_id, start_date, end_date, reason, leave_type, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
            [
                data.staff_id,
                data.start_date,
                data.end_date,
                data.reason ?? null,
                data.leave_type ?? null,
                data.status ?? "pending",
            ]
        );
        return rows[0];
    },

    async updateLeave(id: string, patch: UpdateStaffLeaveBody): Promise<StaffLeave> {
        const keys = Object.keys(patch) as (keyof UpdateStaffLeaveBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM staff_leaves WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k, idx) => {
            setParts.push(`${String(k)} = $${idx + 1}`);
            values.push((patch as any)[k]);
        });

        values.push(id);

        const { rows } = await pool.query(
            `UPDATE staff_leaves
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );

        return rows[0];
    },

    async removeLeave(id: string): Promise<void> {
        await pool.query(`DELETE FROM staff_leaves WHERE id = $1`, [id]);
    },
};
