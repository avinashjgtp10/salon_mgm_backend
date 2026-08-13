import pool, { safeQuery } from "../../config/database";
import {
    Attendance,
    AttendanceSettings,
    UpdateAttendanceBody,
    UpdateSettingsBody,
    AttendanceStatus,
    AttendanceSource,
} from "./attendance.types";

export const attendanceRepository = {

    // ── Settings ──────────────────────────────────────────────────────────────

    async getSettings(salonId: string): Promise<AttendanceSettings | null> {
        const { rows } = await pool.query(
            `SELECT * FROM attendance_settings WHERE salon_id = $1`,
            [salonId]
        );
        return rows[0] || null;
    },

    async upsertSettings(salonId: string, data: UpdateSettingsBody): Promise<AttendanceSettings> {
        const keys = Object.keys(data) as (keyof UpdateSettingsBody)[];
        const setParts = keys.map((k, i) => `${String(k)} = $${i + 2}`);
        const values: any[] = [salonId, ...keys.map(k => (data as any)[k])];

        const { rows } = await pool.query(
            `INSERT INTO attendance_settings (salon_id, ${keys.join(", ")})
             VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})
             ON CONFLICT (salon_id) DO UPDATE
             SET ${setParts.join(", ")}, updated_at = NOW()
             RETURNING *`,
            values
        );
        return rows[0];
    },

    // ── Single record lookup ──────────────────────────────────────────────────

    async findByStaffAndDate(staffId: string, date: string): Promise<Attendance | null> {
        const { rows } = await pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE a.staff_id = $1 AND a.date = $2::date`,
            [staffId, date]
        );
        return rows[0] || null;
    },

    // ── Single staff, date range (for Staff History Attendance tab / Timeline) ──
    async findByStaffAndDateRange(staffId: string, filters: {
        startDate?: string; endDate?: string; status?: string; page?: number; limit?: number;
    } = {}): Promise<{ items: Attendance[]; pagination: { total: number; page: number; limit: number; total_pages: number } }> {
        const conditions: string[] = [`a.staff_id = $1`];
        const values: any[] = [staffId];
        let idx = 2;

        if (filters.startDate) { conditions.push(`a.date >= $${idx++}::date`); values.push(filters.startDate); }
        if (filters.endDate) { conditions.push(`a.date <= $${idx++}::date`); values.push(filters.endDate); }
        if (filters.status) { conditions.push(`a.status = $${idx++}`); values.push(filters.status); }

        const page = Math.max(1, Number(filters.page ?? 1));
        const limit = filters.limit ? Math.max(1, Number(filters.limit)) : undefined;
        const offset = limit ? (page - 1) * limit : 0;
        const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
        if (limit) values.push(limit, offset);

        const { rows } = await safeQuery(() => pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role,
                    COUNT(*) OVER() AS total_count
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE ${conditions.join(" AND ")}
             ORDER BY a.date DESC
             ${limitClause}`,
            values
        ));
        const total = rows.length ? Number(rows[0].total_count) : 0;
        const items = rows.map(({ total_count, ...r }) => r);
        const effectiveLimit = limit ?? Math.max(total, 1);
        return { items, pagination: { total, page, limit: effectiveLimit, total_pages: Math.max(1, Math.ceil(total / effectiveLimit)) } };
    },

    async findById(id: string): Promise<Attendance | null> {
        const { rows } = await pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE a.id = $1`,
            [id]
        );
        return rows[0] || null;
    },

    // ── Today view ───────────────────────────────────────────────────────────

    async findBySalonAndDate(salonId: string, date: string): Promise<Attendance[]> {
        const { rows } = await safeQuery(() => pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE a.salon_id = $1 AND a.date = $2::date
             ORDER BY st.first_name ASC`,
            [salonId, date]
        ));
        return rows;
    },

    // ── Monthly view ─────────────────────────────────────────────────────────

    async findBySalonAndMonth(salonId: string, year: number, month: number): Promise<Attendance[]> {
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const { rows } = await pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE a.salon_id = $1
               AND date_trunc('month', a.date) = $2::date
             ORDER BY st.first_name ASC, a.date ASC`,
            [salonId, startDate]
        );
        return rows;
    },

    // ── Date-range view ──────────────────────────────────────────────────────

    async findBySalonAndRange(salonId: string, startDate: string, endDate: string): Promise<Attendance[]> {
        const { rows } = await pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE a.salon_id = $1
               AND a.date BETWEEN $2::date AND $3::date
             ORDER BY st.first_name ASC, a.date ASC`,
            [salonId, startDate, endDate]
        );
        return rows;
    },

    // ── Upsert check-in ──────────────────────────────────────────────────────

    async upsertCheckIn(params: {
        salonId: string;
        staffId: string;
        date: string;
        checkIn: string;
        status: AttendanceStatus;
        source: AttendanceSource;
        note?: string;
    }): Promise<Attendance> {
        const { salonId, staffId, date, checkIn, status, source, note } = params;
        const { rows } = await pool.query(
            `INSERT INTO attendance (salon_id, staff_id, date, check_in, status, source, note)
             VALUES ($1, $2, $3::date, $4::timestamptz, $5, $6, $7)
             ON CONFLICT (salon_id, staff_id, date) DO UPDATE
             SET check_in  = EXCLUDED.check_in,
                 status    = EXCLUDED.status,
                 source    = EXCLUDED.source,
                 note      = COALESCE(EXCLUDED.note, attendance.note),
                 updated_at = NOW()
             RETURNING *`,
            [salonId, staffId, date, checkIn, status, source, note ?? null]
        );
        return rows[0];
    },

    // ── Upsert check-out and recalculate hours ────────────────────────────────

    async upsertCheckOut(params: {
        salonId: string;
        staffId: string;
        date: string;
        checkOut: string;
        status: AttendanceStatus;
        hoursWorked: number;
        note?: string;
    }): Promise<Attendance> {
        const { salonId, staffId, date, checkOut, status, hoursWorked, note } = params;
        const { rows } = await pool.query(
            `UPDATE attendance
             SET check_out    = $4::timestamptz,
                 hours_worked = $5,
                 status       = $6,
                 note         = COALESCE($7, note),
                 updated_at   = NOW()
             WHERE salon_id = $1 AND staff_id = $2 AND date = $3::date
             RETURNING *`,
            [salonId, staffId, date, checkOut, hoursWorked, status, note ?? null]
        );
        return rows[0];
    },

    // ── Upsert (used by auto-attendance and device push) ─────────────────────

    async upsert(params: {
        salonId: string;
        staffId: string;
        date: string;
        status: AttendanceStatus;
        source: AttendanceSource;
        checkIn?: string;
        checkOut?: string;
        hoursWorked?: number;
        note?: string;
    }): Promise<Attendance> {
        const { salonId, staffId, date, status, source, checkIn, checkOut, hoursWorked, note } = params;
        const { rows } = await pool.query(
            `INSERT INTO attendance (salon_id, staff_id, date, status, source, check_in, check_out, hours_worked, note)
             VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (salon_id, staff_id, date) DO UPDATE
             SET status       = EXCLUDED.status,
                 source       = CASE WHEN attendance.source = 'manual' THEN EXCLUDED.source ELSE attendance.source END,
                 check_in     = COALESCE(attendance.check_in, EXCLUDED.check_in),
                 check_out    = COALESCE(EXCLUDED.check_out, attendance.check_out),
                 hours_worked = COALESCE(EXCLUDED.hours_worked, attendance.hours_worked),
                 note         = COALESCE(EXCLUDED.note, attendance.note),
                 updated_at   = NOW()
             RETURNING *`,
            [salonId, staffId, date, status, source, checkIn ?? null, checkOut ?? null, hoursWorked ?? null, note ?? null]
        );
        return rows[0];
    },

    // ── Manual mark / edit ────────────────────────────────────────────────────

    async manualUpsert(params: {
        salonId: string;
        staffId: string;
        date: string;
        status: AttendanceStatus;
        checkIn?: string;
        checkOut?: string;
        hoursWorked?: number;
        note?: string;
    }): Promise<Attendance> {
        const { salonId, staffId, date, status, checkIn, checkOut, hoursWorked, note } = params;
        const { rows } = await pool.query(
            `INSERT INTO attendance (salon_id, staff_id, date, status, source, check_in, check_out, hours_worked, note)
             VALUES ($1, $2, $3::date, $4, 'manual', $5, $6, $7, $8)
             ON CONFLICT (salon_id, staff_id, date) DO UPDATE
             SET status       = EXCLUDED.status,
                 source       = 'manual',
                 check_in     = EXCLUDED.check_in,
                 check_out    = EXCLUDED.check_out,
                 hours_worked = EXCLUDED.hours_worked,
                 note         = EXCLUDED.note,
                 updated_at   = NOW()
             RETURNING *`,
            [salonId, staffId, date, status, checkIn ?? null, checkOut ?? null, hoursWorked ?? null, note ?? null]
        );
        return rows[0];
    },

    async updateById(id: string, patch: UpdateAttendanceBody): Promise<Attendance> {
        const keys = Object.keys(patch) as (keyof UpdateAttendanceBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM attendance WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts = keys.map((k, i) => `${String(k)} = $${i + 2}`);
        const values: any[] = [id, ...keys.map(k => (patch as any)[k])];
        setParts.push(`updated_at = NOW()`);

        const { rows } = await pool.query(
            `UPDATE attendance SET ${setParts.join(", ")} WHERE id = $1 RETURNING *`,
            values
        );
        return rows[0];
    },

    // ── Daily summary counts ──────────────────────────────────────────────────

    async getDailySummaryCounts(salonId: string, date: string): Promise<{
        present: number; absent: number; late: number; on_leave: number; half_day: number;
    }> {
        const { rows } = await safeQuery(() => pool.query(
            `SELECT
               COUNT(*) FILTER (WHERE status = 'present')  AS present,
               COUNT(*) FILTER (WHERE status = 'absent')   AS absent,
               COUNT(*) FILTER (WHERE status = 'late')     AS late,
               COUNT(*) FILTER (WHERE status = 'on_leave') AS on_leave,
               COUNT(*) FILTER (WHERE status = 'half_day') AS half_day
             FROM attendance
             WHERE salon_id = $1 AND date = $2::date`,
            [salonId, date]
        ));
        return {
            present:  parseInt(rows[0]?.present  ?? "0", 10),
            absent:   parseInt(rows[0]?.absent   ?? "0", 10),
            late:     parseInt(rows[0]?.late      ?? "0", 10),
            on_leave: parseInt(rows[0]?.on_leave  ?? "0", 10),
            half_day: parseInt(rows[0]?.half_day  ?? "0", 10),
        };
    },

    // ── Staff list for a salon (for today view) ───────────────────────────────

    async getActiveSalonStaff(salonId: string): Promise<{ id: string; full_name: string; role: string }[]> {
        const { rows } = await safeQuery(() => pool.query(
            `SELECT id,
                    TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS full_name,
                    COALESCE(designation, '')                               AS role
             FROM staff
             WHERE salon_id = $1 AND is_active = true
             ORDER BY first_name ASC`,
            [salonId]
        ));
        return rows;
    },

    // ── Export ────────────────────────────────────────────────────────────────

    async getMonthlyForExport(salonId: string, year: number, month: number): Promise<Attendance[]> {
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const { rows } = await pool.query(
            `SELECT a.*,
                    TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                    COALESCE(st.designation, '') AS staff_role
             FROM attendance a
             JOIN staff st ON st.id = a.staff_id
             WHERE a.salon_id = $1
               AND date_trunc('month', a.date) = $2::date
             ORDER BY st.first_name ASC, a.date ASC`,
            [salonId, startDate]
        );
        return rows;
    },

    // ── Scheduled hours from shift (for today view) ───────────────────────────

    async getScheduledHoursForStaff(
        salonId: string,
        date: string,
        dayOfWeek: number
    ): Promise<Map<string, number | null>> {
        const { rows } = await safeQuery(() => pool.query(
            `WITH best_schedule AS (
               SELECT DISTINCT ON (ss.staff_id)
                 ss.staff_id,
                 ss.start_time,
                 ss.end_time,
                 ss.is_available
               FROM staff_schedules ss
               JOIN staff st ON st.id = ss.staff_id
               WHERE st.salon_id = $1
                 AND st.is_active = true
                 AND (ss.date = $2::date OR (ss.date IS NULL AND ss.day_of_week = $3))
               ORDER BY ss.staff_id, ss.date NULLS LAST
             )
             SELECT
               staff_id,
               CASE WHEN is_available AND start_time IS NOT NULL AND end_time IS NOT NULL
                 THEN ROUND(
                   EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600.0,
                   2
                 )
                 ELSE NULL
               END AS scheduled_hours
             FROM best_schedule`,
            [salonId, date, dayOfWeek]
        ));
        const map = new Map<string, number | null>();
        for (const row of rows) {
            map.set(row.staff_id, row.scheduled_hours != null ? parseFloat(row.scheduled_hours) : null);
        }
        return map;
    },

    // ── Leave check ───────────────────────────────────────────────────────────

    async hasApprovedLeave(staffId: string, date: string): Promise<boolean> {
        const { rows } = await pool.query(
            `SELECT 1 FROM staff_leaves
             WHERE staff_id = $1
               AND status = 'approved'
               AND start_date::date <= $2::date
               AND end_date::date   >= $2::date
             LIMIT 1`,
            [staffId, date]
        );
        return rows.length > 0;
    },

    // Every (staff_id, date) pair covered by an approved leave that overlaps
    // the range — expanded via generate_series so a single multi-day leave
    // row still marks each individual day, matching how attendance rows are
    // one-per-day. Used by getRange to exclude leave days from hour totals
    // without a per-row query per staff member.
    async findApprovedLeaveDatesInRange(
        salonId: string,
        startDate: string,
        endDate: string
    ): Promise<{ staff_id: string; date: string }[]> {
        const { rows } = await pool.query(
            `SELECT sl.staff_id,
                    TO_CHAR(d.day, 'YYYY-MM-DD') AS date
             FROM staff_leaves sl
             JOIN staff st ON st.id = sl.staff_id AND st.salon_id = $1
             CROSS JOIN LATERAL generate_series(
               GREATEST(sl.start_date::date, $2::date),
               LEAST(sl.end_date::date, $3::date),
               interval '1 day'
             ) AS d(day)
             WHERE sl.status = 'approved'
               AND sl.start_date::date <= $3::date
               AND sl.end_date::date   >= $2::date`,
            [salonId, startDate, endDate]
        );
        return rows;
    },
};
