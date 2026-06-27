import pool from "../../config/database";
import {
    Appointment,
    CreateAppointmentBody,
    UpdateAppointmentBody,
} from "./appointments.types";

export const appointmentsRepository = {

    // ✅ FIX — LEFT JOIN payments so payment_status reflects actual payment records
    // ✅ WA-AUTO — Added client phone, phone_country_code, salon_name for WhatsApp automation
    async findById(id: string): Promise<Appointment | null> {
        const { rows } = await pool.query(
            `SELECT a.*,
                c.full_name          AS client_name,
                c.phone_number       AS client_phone,
                c.phone_country_code AS client_phone_code,
                c.email              AS client_email,
                s.business_name      AS salon_name,
                COALESCE(s.email, u.email) AS salon_email,
                CASE
                  WHEN EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id)
                   AND (SELECT due_amount FROM payments p WHERE p.appointment_id = a.id ORDER BY p.created_at DESC LIMIT 1) = 0
                  THEN 'paid'::text
                  WHEN EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial'))
                  THEN 'partial'::text
                  ELSE 'unpaid'::text
                END AS payment_status,
                COALESCE((SELECT SUM(paid_amount) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS paid_amount,
                (SELECT payment_method FROM payments p WHERE p.appointment_id = a.id ORDER BY p.created_at DESC LIMIT 1) AS payment_method
             FROM appointments a
             LEFT JOIN clients c ON a.client_id  = c.id
             LEFT JOIN salons  s ON a.salon_id   = s.id
             LEFT JOIN users   u ON s.owner_id   = u.id
             WHERE a.id = $1`,
            [id]
        );
        return rows[0] || null;
    },

    // ✅ FIX — LEFT JOIN payments so payment_status is accurate on list, supports server-side pagination
    async listBySalonId(
        salonId: string,
        filters: {
            date?: string;
            staff_id?: string;
            status?: string;
            start_date?: string;
            end_date?: string;
            page?: number;
            limit?: number;
        }
    ): Promise<{ data: Appointment[]; totalRecords: number; totalPages: number; currentPage: number }> {
        const page = Math.max(1, filters.page || 1);
        const limit = Math.min(200, Math.max(1, filters.limit || 50));
        const offset = (page - 1) * limit;

        const conditions: string[] = [`a.salon_id = $1`];
        const values: any[] = [salonId];
        let idx = 2;

        if (filters.date) {
            conditions.push(`DATE(a.scheduled_at) = $${idx}::date`);
            values.push(filters.date); idx++;
        }
        if (filters.start_date) {
            conditions.push(`a.scheduled_at >= $${idx}::timestamptz`);
            values.push(filters.start_date + "T00:00:00Z"); idx++;
        }
        if (filters.end_date) {
            conditions.push(`a.scheduled_at < ($${idx}::date + INTERVAL '1 day')`);
            values.push(filters.end_date); idx++;
        }
        if (filters.staff_id) {
            conditions.push(`a.staff_id = $${idx}`);
            values.push(filters.staff_id); idx++;
        }
        if (filters.status) {
            conditions.push(`a.status = $${idx}`);
            values.push(filters.status); idx++;
        }

        const whereClause = conditions.join(" AND ");

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM appointments a WHERE ${whereClause}`,
            values
        );
        const totalRecords = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

        const { rows } = await pool.query(
            `WITH pay_agg AS (
               SELECT
                 appointment_id,
                 SUM(paid_amount) FILTER (WHERE status IN ('completed','partial'))  AS total_paid,
                 MAX(due_amount)  FILTER (WHERE created_at = (
                   SELECT MAX(created_at) FROM payments p2 WHERE p2.appointment_id = payments.appointment_id
                 ))                                                                  AS latest_due,
                 MAX(payment_method) FILTER (WHERE created_at = (
                   SELECT MAX(created_at) FROM payments p2 WHERE p2.appointment_id = payments.appointment_id
                 ))                                                                  AS latest_method,
                 COUNT(*) FILTER (WHERE status IN ('completed','partial'))           AS pay_count
               FROM payments
               GROUP BY appointment_id
             )
             SELECT a.*, c.full_name AS client_name,
               CASE
                 WHEN pa.pay_count > 0 AND COALESCE(pa.latest_due, 1) = 0 THEN 'paid'::text
                 WHEN pa.pay_count > 0                                      THEN 'partial'::text
                 ELSE 'unpaid'::text
               END AS payment_status,
               COALESCE(pa.total_paid, 0)    AS paid_amount,
               pa.latest_method              AS payment_method
             FROM appointments a
             LEFT JOIN clients c   ON a.client_id = c.id
             LEFT JOIN pay_agg pa  ON pa.appointment_id = a.id
             WHERE ${whereClause}
             ORDER BY a.scheduled_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...values, limit, offset]
        );

        return { data: rows, totalRecords, totalPages, currentPage: page };
    },

    async listByClientId(clientId: string): Promise<Appointment[]> {
        const { rows } = await pool.query(
            `SELECT * FROM appointments WHERE client_id = $1 ORDER BY scheduled_at DESC`,
            [clientId]
        );
        return rows;
    },

    async hasConflict(params: {
        staffId: string;
        scheduledAt: string;
        durationMinutes: number;
        excludeId?: string;
    }): Promise<boolean> {
        const { staffId, scheduledAt, durationMinutes, excludeId } = params;
        const query = `
            SELECT 1 FROM appointments
            WHERE staff_id = $1
              AND LOWER(status::text) NOT IN ('cancelled', 'no_show', 'completed')
              AND scheduled_at < ($2::timestamptz + ($3 * interval '1 minute'))
              AND (scheduled_at + (duration_minutes * interval '1 minute')) > $2::timestamptz
              ${excludeId ? `AND id != $4` : ""}
            LIMIT 1
        `;
        const values: any[] = [staffId, scheduledAt, durationMinutes];
        if (excludeId) values.push(excludeId);
        const { rows } = await pool.query(query, values);
        return rows.length > 0;
    },

    async create(data: CreateAppointmentBody, createdBy: string): Promise<Appointment> {
        const { rows } = await pool.query(
            `INSERT INTO appointments (
                salon_id, branch_id, client_id, staff_id, service_id,
                title, notes, staff_alert, status,
                scheduled_at, duration_minutes,
                ends_at,
                colour, created_by,
                services, package_items, product_items, membership_items
            )
            VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11,
                ($10::timestamptz + ($11::integer * INTERVAL '1 minute')),
                $12, $13,
                $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb
            )
            RETURNING *`,
            [
                data.salon_id,
                data.branch_id          ?? null,
                data.client_id          ?? null,
                data.staff_id           ?? null,
                data.service_id         ?? null,
                data.title              ?? "Appointment",
                data.notes              ?? null,
                data.staff_alert        ?? null,
                data.status             ?? "booked",
                data.scheduled_at,
                data.duration_minutes,
                data.colour             ?? null,
                createdBy,
                JSON.stringify(data.services         ?? []),
                JSON.stringify(data.package_items    ?? []),
                JSON.stringify(data.product_items    ?? []),
                JSON.stringify(data.membership_items ?? []),
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateAppointmentBody): Promise<Appointment> {
        const JSONB_FIELDS = new Set(["services", "package_items", "product_items", "membership_items"]);

        // Remove ends_at from the patch if auto-recalculation is triggered
        if ("scheduled_at" in patch || "duration_minutes" in patch) {
            delete patch.ends_at;
        }

        const keys = Object.keys(patch) as (keyof UpdateAppointmentBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];
        let scheduledAtIdx: number | null = null;
        let durationIdx: number | null = null;

        keys.forEach((k) => {
            const idx = values.length + 1;
            if (JSONB_FIELDS.has(k as string)) {
                setParts.push(`${String(k)} = $${idx}::jsonb`);
                values.push(JSON.stringify((patch as any)[k]));
            } else {
                setParts.push(`${String(k)} = $${idx}`);
                values.push((patch as any)[k]);
            }
            if (k === "scheduled_at")     scheduledAtIdx = idx;
            if (k === "duration_minutes") durationIdx    = idx;
        });

        // ✅ Auto-recalculate ends_at when scheduled_at or duration_minutes changes
        if (scheduledAtIdx !== null || durationIdx !== null) {
            const schedPart = scheduledAtIdx !== null ? `$${scheduledAtIdx}::timestamptz` : `scheduled_at`;
            const durPart   = durationIdx    !== null ? `$${durationIdx}::integer`        : `duration_minutes`;
            setParts.push(`ends_at = (${schedPart} + (${durPart} * INTERVAL '1 minute'))`);
        }

        setParts.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await pool.query(
            `UPDATE appointments SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
            values
        );
        return rows[0];
    },

    async updateStatus(id: string, status: string): Promise<Appointment> {
        const { rows } = await pool.query(
            `UPDATE appointments SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id, status]
        );
        return rows[0];
    },

    async updatePaymentStatus(id: string, paymentStatus: string): Promise<Appointment> {
        const { rows } = await pool.query(
            `UPDATE appointments SET payment_status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id, paymentStatus]
        );
        return rows[0];
    },

    async deleteById(id: string): Promise<Appointment | null> {
        const { rows } = await pool.query(
            `DELETE FROM appointments WHERE id = $1 RETURNING *`,
            [id]
        );
        return rows[0] || null;
    },

    async linkSale(id: string, saleId: string): Promise<Appointment> {
        const { rows } = await pool.query(
            `UPDATE appointments
             SET sale_id = $2, status = 'completed', updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, saleId]
        );
        return rows[0];
    },

    async exportList(filters: {
        salon_id?: string;
        status?: string;
        start_date?: string;
        end_date?: string;
    }): Promise<Appointment[]> {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (filters.salon_id) {
            conditions.push(`salon_id = $${idx}`);
            values.push(filters.salon_id); idx++;
        }
        if (filters.status) {
            conditions.push(`status = $${idx}`);
            values.push(filters.status); idx++;
        }
        if (filters.start_date) {
            conditions.push(`scheduled_at >= $${idx}::date`);
            values.push(filters.start_date); idx++;
        }
        if (filters.end_date) {
            conditions.push(`scheduled_at < ($${idx}::date + INTERVAL '1 day')`);
            values.push(filters.end_date); idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const { rows } = await pool.query(
            `SELECT * FROM appointments ${where} ORDER BY scheduled_at DESC`,
            values
        );
        return rows;
    },
};