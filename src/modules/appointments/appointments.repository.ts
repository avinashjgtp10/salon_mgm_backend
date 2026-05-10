import pool from "../../config/database";
import {
    Appointment,
    CreateAppointmentBody,
    UpdateAppointmentBody,
} from "./appointments.types";

export const appointmentsRepository = {

    // ✅ FIX — LEFT JOIN payments so payment_status reflects actual payment records
    async findById(id: string): Promise<Appointment | null> {
        const { rows } = await pool.query(
            `SELECT a.*,
                COALESCE(
                  (SELECT CASE
                      WHEN bool_or(p.status = 'completed') THEN 'paid'::text
                      WHEN bool_or(p.status = 'partial') THEN 'partial'::text
                      ELSE 'unpaid'::text
                  END
                  FROM payments p
                  WHERE p.appointment_id = a.id),
                  'unpaid'::text
                ) AS payment_status,
                COALESCE((SELECT SUM(net_amount) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS paid_amount
             FROM appointments a
             WHERE a.id = $1`,
            [id]
        );
        return rows[0] || null;
    },

    // ✅ FIX — LEFT JOIN payments so payment_status is accurate on list
    async listBySalonId(
        salonId: string,
        filters: { date?: string; staff_id?: string; status?: string }
    ): Promise<Appointment[]> {
        const conditions: string[] = [`a.salon_id = $1`];
        const values: any[] = [salonId];
        let idx = 2;

        if (filters.date) {
            conditions.push(`DATE(a.scheduled_at) = $${idx}::date`);
            values.push(filters.date); idx++;
        }
        if (filters.staff_id) {
            conditions.push(`a.staff_id = $${idx}`);
            values.push(filters.staff_id); idx++;
        }
        if (filters.status) {
            conditions.push(`a.status = $${idx}`);
            values.push(filters.status); idx++;
        }

        const { rows } = await pool.query(
            `SELECT a.*,
                COALESCE(
                  (SELECT CASE
                      WHEN bool_or(p.status = 'completed') THEN 'paid'::text
                      WHEN bool_or(p.status = 'partial') THEN 'partial'::text
                      ELSE 'unpaid'::text
                  END
                  FROM payments p
                  WHERE p.appointment_id = a.id),
                  'unpaid'::text
                ) AS payment_status,
                COALESCE((SELECT SUM(net_amount) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS paid_amount
             FROM appointments a
             WHERE ${conditions.join(" AND ")}
             ORDER BY a.scheduled_at ASC`,
            values
        );
        return rows;
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
              AND status NOT IN ('cancelled', 'no_show')
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
                title, notes, status,
                scheduled_at, duration_minutes,
                ends_at,
                colour, created_by,
                services, package_items, product_items, membership_items
            )
            VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, 'booked',
                $8, $9,
                ($8::timestamptz + ($9::integer * INTERVAL '1 minute')),
                $10, $11,
                $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb
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
        const keys = Object.keys(patch) as (keyof UpdateAppointmentBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k) => {
            const idx = values.length + 1;
            if (JSONB_FIELDS.has(k as string)) {
                setParts.push(`${String(k)} = $${idx}::jsonb`);
                values.push(JSON.stringify((patch as any)[k]));
            } else {
                setParts.push(`${String(k)} = $${idx}`);
                values.push((patch as any)[k]);
            }
        });

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