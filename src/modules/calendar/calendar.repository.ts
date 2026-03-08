import pool from "../../config/database";
import {
    Appointment,
    CreateAppointmentBody,
    UpdateAppointmentBody,
    ListAppointmentsFilters,
} from "./calendar.types";

export const calendarRepository = {

    async findById(id: string): Promise<Appointment | null> {
        const { rows } = await pool.query(
            `SELECT * FROM appointments WHERE id = $1`, [id]
        );
        return rows[0] || null;
    },

    async list(
        filters: ListAppointmentsFilters
    ): Promise<{ data: Appointment[]; total: number }> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`salon_id  = $${idx++}`); values.push(filters.salon_id); }
        if (filters.branch_id) { conditions.push(`branch_id = $${idx++}`); values.push(filters.branch_id); }
        if (filters.client_id) { conditions.push(`client_id = $${idx++}`); values.push(filters.client_id); }
        if (filters.staff_id) { conditions.push(`staff_id  = $${idx++}`); values.push(filters.staff_id); }
        if (filters.status) { conditions.push(`status    = $${idx++}`); values.push(filters.status); }

        if (filters.date) {
            conditions.push(`scheduled_at::date = $${idx++}`);
            values.push(filters.date);
        }
        if (filters.from) { conditions.push(`scheduled_at >= $${idx++}`); values.push(filters.from); }
        if (filters.to) { conditions.push(`ends_at      <= $${idx++}`); values.push(filters.to); }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 50;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM appointments ${where}`, values
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT * FROM appointments ${where}
       ORDER BY scheduled_at ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset]
        );

        return { data: rows, total };
    },

    async hasConflict(params: {
        staff_id: string;
        scheduled_at: string;
        duration_minutes: number;
        excludeId?: string;
    }): Promise<boolean> {
        const { staff_id, scheduled_at, duration_minutes, excludeId } = params;
        const excludeClause = excludeId ? `AND id <> $4` : "";

        const { rows } = await pool.query(
            `SELECT id FROM appointments
       WHERE staff_id = $1
         AND status   NOT IN ('cancelled', 'no_show')
         AND scheduled_at < ($2::timestamptz + ($3::text || ' minutes')::interval)
         AND ends_at   >  $2::timestamptz
         ${excludeClause}
       LIMIT 1`,
            excludeId
                ? [staff_id, scheduled_at, duration_minutes, excludeId]
                : [staff_id, scheduled_at, duration_minutes]
        );
        return rows.length > 0;
    },

    async create(data: CreateAppointmentBody, createdBy: string): Promise<Appointment> {
        const { rows } = await pool.query(
            `INSERT INTO appointments (
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
        ($8::timestamptz + ($9::text || ' minutes')::interval),
        $10, $11
      )
      RETURNING *`,
            [
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
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateAppointmentBody): Promise<Appointment> {
        const keys = Object.keys(patch) as (keyof UpdateAppointmentBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: unknown[] = [];

        keys.forEach((k, i) => {
            setParts.push(`${k} = $${i + 1}`);
            values.push((patch as Record<string, unknown>)[k]);
        });

        const hasScheduled = "scheduled_at" in patch;
        const hasDuration = "duration_minutes" in patch;

        if (hasScheduled || hasDuration) {
            const scheduledExpr = hasScheduled
                ? `$${keys.indexOf("scheduled_at" as keyof UpdateAppointmentBody) + 1}::timestamptz`
                : `scheduled_at`;
            const durationExpr = hasDuration
                ? `($${keys.indexOf("duration_minutes" as keyof UpdateAppointmentBody) + 1}::text || ' minutes')::interval`
                : `(duration_minutes::text || ' minutes')::interval`;
            setParts.push(`ends_at = ${scheduledExpr} + ${durationExpr}`);
        }

        setParts.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await pool.query(
            `UPDATE appointments
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );
        return rows[0];
    },

    async updateStatus(
        id: string,
        status: string,
        extra: Record<string, unknown> = {}
    ): Promise<Appointment> {
        const extraKeys = Object.keys(extra);
        const setParts = [`status = $1`, `updated_at = NOW()`];
        const values: unknown[] = [status];

        extraKeys.forEach((k, i) => {
            setParts.push(`${k} = $${i + 2}`);
            values.push(extra[k]);
        });

        values.push(id);

        const { rows } = await pool.query(
            `UPDATE appointments
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );
        return rows[0];
    },

    async linkSale(appointmentId: string, saleId: string): Promise<void> {
        await pool.query(
            `UPDATE appointments
       SET sale_id = $1, status = 'completed', updated_at = NOW()
       WHERE id = $2`,
            [saleId, appointmentId]
        );
    },
};
