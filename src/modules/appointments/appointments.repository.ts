import pool from "../../config/database";
import {
    Appointment,
    AppointmentServiceConsumableRecord,
    CreateAppointmentBody,
    UpdateAppointmentBody,
} from "./appointments.types";

// Bootstrap: patch the pre-existing `appointments` table with a persisted flag
// for the "Apply Membership" checkbox — unlike package coverage (which is
// baked into each service row's is_package_service/total=0), membership wallet
// coverage was previously only ever recorded via the payments table at actual
// checkout, so re-opening an unpaid appointment always showed the checkbox
// unchecked even when staff had explicitly applied it and saved.
export async function ensureTable(): Promise<void> {
    await pool.query(
        `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS apply_membership_wallet BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    // Same persisted-checkbox pattern as apply_membership_wallet above, for the
    // percentage/loyalty membership discount benefit — was referenced in
    // appointment PATCH payloads without ever having a matching column, so
    // saving a booking with this benefit toggled crashed the update with
    // "column \"apply_membership_discount\" of relation \"appointments\" does
    // not exist" the moment a real request included it.
    await pool.query(
        `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS apply_membership_discount BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    // Sibling of apply_membership_discount above — Discount Balance and
    // Loyalty are now independently toggleable and stack when both are
    // checked (see payments.service.ts's applyMembershipDiscountForBooking),
    // so each needs its own persisted checkbox state.
    await pool.query(
        `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS apply_loyalty_discount BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    // Persists the "Include GST" checkbox state on the appointment itself —
    // previously it only ever reached the payments table (at actual
    // checkout), so reopening a paid appointment that was deliberately
    // billed without GST re-defaulted the checkbox to on and recomputed a
    // phantom GST-sized due amount. TRUE for every pre-existing row, since
    // that matches the assumed-on behavior every appointment had before this
    // flag existed.
    await pool.query(
        `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS include_gst BOOLEAN NOT NULL DEFAULT TRUE`,
    );
    // Column kept for backward compatibility with any historical rows/reports
    // that still reference it — "Delete Appointment" now performs a true hard
    // delete (see deleteById below), so no row written going forward ever has
    // this set.
    await pool.query(
        `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`,
    );
    // Distinguishes "was fully Paid, then content-edited back down to
    // partial" from a genuinely-original partial/deposit booking — the
    // frontend keeps a real partial booking's items locked (staff shouldn't
    // change what a deposit was collected against), but this specific case
    // must stay editable so staff can keep adjusting before collecting the
    // difference. FALSE for every pre-existing row and every appointment
    // that has never been through this flow.
    await pool.query(
        `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reopened_from_paid BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    // Unit Conversion system: appointment_service_consumables.standard_qty/
    // actual_qty are always canonical base-unit amounts — what's actually
    // deducted (see appointmentConsumablesService.collectServiceRowItems).
    // entered_qty preserves what staff actually typed, in `unit`, before
    // conversion — for usage-history/audit display only, never used for
    // deduction math. NULL on every row written before this column existed;
    // readers fall back to actual_qty for those.
    await pool.query(
        `ALTER TABLE appointment_service_consumables ADD COLUMN IF NOT EXISTS entered_qty NUMERIC NULL`,
    );
}

export const appointmentsRepository = {

    // ✅ WA-AUTO — Added client phone, phone_country_code, salon_name for WhatsApp automation
    async findById(id: string): Promise<Appointment | null> {
        const { rows } = await pool.query(
            `SELECT a.*,
                -- The real invoice number is the linked sale's own sequential
                -- invoice_number (sales.repository.ts's per-salon counter) —
                -- NULL until the appointment is actually billed. Previously
                -- this counted every appointment ever created for the salon
                -- (paid or not), which diverged from Sales Summary/reports
                -- (both read sales.invoice_number directly).
                (SELECT s.invoice_number FROM sales s WHERE s.appointment_id = a.id LIMIT 1) AS invoice_number,
                c.full_name                              AS client_name,
                c.phone_number                           AS client_phone,
                c.phone_country_code                     AS client_phone_code,
                c.email                                  AS client_email,
                TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
                st.phone                                 AS staff_phone,
                st.email                                 AS staff_email,
                s.business_name                          AS salon_name,
                COALESCE(s.email, u.email)               AS salon_email,
                s.currency                                AS salon_currency,
                COALESCE((SELECT SUM(paid_amount) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS paid_amount,
                (SELECT payment_method FROM payments p WHERE p.appointment_id = a.id ORDER BY p.created_at DESC LIMIT 1) AS payment_method,
                COALESCE((SELECT SUM(reward_points_value) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS reward_points_value,
                COALESCE((SELECT SUM(membership_wallet_used) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS membership_wallet_used,
                -- MAX, not SUM — every payment row for this appointment carries
                -- the SAME cumulative total (a repeat/completing call recovers
                -- and re-stores it via getMembershipDiscountForAppointment's own
                -- MAX read, see payments.service.ts), not a per-call delta.
                COALESCE((SELECT MAX(membership_discount_used) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS membership_discount_used,
                -- Just the Discount Balance (percentage) portion of the figure
                -- above — the only part with its own ledger row (see
                -- deductDiscountBalanceForBooking). Loyalty's share is derived
                -- on the frontend as membership_discount_used minus this, since
                -- loyalty never writes a ledger row (no balance to track).
                COALESCE((SELECT SUM(amount_deducted) FROM membership_usage_log WHERE appointment_id = a.id AND notes = 'membership_discount'), 0) AS membership_percentage_discount_used,
                COALESCE((SELECT SUM(ewallet_used) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS ewallet_used,
                COALESCE((SELECT SUM(referral_credit_used) FROM payments p WHERE p.appointment_id = a.id AND p.status IN ('completed', 'partial')), 0) AS referral_credit_used,
                (SELECT split_details FROM payments p WHERE p.appointment_id = a.id ORDER BY p.created_at DESC LIMIT 1) AS split_details,
                (SELECT tax_breakdown FROM payments p WHERE p.appointment_id = a.id AND p.tax_breakdown IS NOT NULL ORDER BY p.created_at DESC LIMIT 1) AS tax_breakdown,
                (SELECT MAX(created_at) FROM payments p WHERE p.appointment_id = a.id AND p.tax_breakdown IS NOT NULL) AS last_payment_at
             FROM appointments a
             LEFT JOIN clients c  ON a.client_id = c.id
             LEFT JOIN staff   st ON a.staff_id  = st.id
             LEFT JOIN salons  s  ON a.salon_id  = s.id
             LEFT JOIN users   u  ON s.owner_id  = u.id
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

        // Salon calendar days are Asia/Kolkata days, but the DB session runs in
        // UTC — comparing scheduled_at (timestamptz) against a bare "YYYY-MM-DD"
        // implicitly anchors the day boundary to UTC midnight (05:30 IST), not
        // local midnight. That silently dropped any appointment booked between
        // IST 00:00–05:30 from "today"'s list — it fell into the *previous*
        // UTC day and never matched. Anchoring explicitly to +05:30 fixes both
        // the single-date and start/end range filters the same way.
        if (filters.date) {
            conditions.push(`a.scheduled_at >= $${idx}::timestamptz AND a.scheduled_at < ($${idx}::timestamptz + INTERVAL '1 day')`);
            values.push(filters.date + "T00:00:00+05:30"); idx++;
        }
        if (filters.start_date) {
            conditions.push(`a.scheduled_at >= $${idx}::timestamptz`);
            values.push(filters.start_date + "T00:00:00+05:30"); idx++;
        }
        if (filters.end_date) {
            conditions.push(`a.scheduled_at < ($${idx}::timestamptz + INTERVAL '1 day')`);
            values.push(filters.end_date + "T00:00:00+05:30"); idx++;
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
                 COUNT(*) FILTER (WHERE status IN ('completed','partial'))           AS pay_count,
                 SUM(reward_points_value) FILTER (WHERE status IN ('completed','partial')) AS total_reward_points_value,
                 SUM(membership_wallet_used) FILTER (WHERE status IN ('completed','partial')) AS total_membership_wallet_used,
                 -- MAX not SUM — see findById()'s identical comment.
                 MAX(membership_discount_used) FILTER (WHERE status IN ('completed','partial')) AS latest_membership_discount_used,
                 SUM(ewallet_used) FILTER (WHERE status IN ('completed','partial')) AS total_ewallet_used,
                 SUM(referral_credit_used) FILTER (WHERE status IN ('completed','partial')) AS total_referral_credit_used
               FROM payments
               GROUP BY appointment_id
             )
             SELECT a.*,
               -- See findById()'s identical comment — invoice_number now comes
               -- from the linked sale's own sequential number, not an
               -- appointment-count, so it matches Sales Summary/reports.
               (SELECT s.invoice_number FROM sales s WHERE s.appointment_id = a.id LIMIT 1) AS invoice_number,
               c.full_name    AS client_name,
               c.phone_number AS client_phone,
               c.email        AS client_email,
               TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))) AS staff_name,
               COALESCE(pa.total_paid, 0)    AS paid_amount,
               pa.latest_method              AS payment_method,
               COALESCE(pa.total_reward_points_value, 0) AS reward_points_value,
               COALESCE(pa.total_membership_wallet_used, 0) AS membership_wallet_used,
               COALESCE(pa.latest_membership_discount_used, 0) AS membership_discount_used,
               COALESCE((SELECT SUM(amount_deducted) FROM membership_usage_log WHERE appointment_id = a.id AND notes = 'membership_discount'), 0) AS membership_percentage_discount_used,
               COALESCE(pa.total_ewallet_used, 0) AS ewallet_used,
               COALESCE(pa.total_referral_credit_used, 0) AS referral_credit_used,
               (SELECT split_details FROM payments p WHERE p.appointment_id = a.id ORDER BY p.created_at DESC LIMIT 1) AS split_details,
               (SELECT tax_breakdown FROM payments p WHERE p.appointment_id = a.id AND p.tax_breakdown IS NOT NULL ORDER BY p.created_at DESC LIMIT 1) AS tax_breakdown,
               (SELECT MAX(created_at) FROM payments p WHERE p.appointment_id = a.id AND p.tax_breakdown IS NOT NULL) AS last_payment_at
             FROM appointments a
             LEFT JOIN clients c   ON a.client_id  = c.id
             LEFT JOIN staff   st  ON a.staff_id   = st.id
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
              AND LOWER(status::text) NOT IN ('cancelled', 'no-show', 'paid', 'deleted')
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
                services, package_items, product_items, membership_items,
                discount_value, discount_type, discount_applies_to, ex_charges, tip_amount, tip_added_to_salon, tip_breakdown, gst_percent,
                apply_membership_wallet, include_gst
            )
            VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11,
                ($10::timestamptz + ($11::integer * INTERVAL '1 minute')),
                $12, $13,
                $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
                $18, $19, $20::jsonb, $21, $22, $23, $24::jsonb, $25,
                $26, $27
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
                data.discount_value     ?? 0,
                data.discount_type      ?? "percentage",
                // NULL (not an array) when the client didn't send a selection —
                // that's the legacy-scope signal the engine keys off. An empty
                // array is preserved as "[]" ("discount nothing"), which is a
                // deliberately different thing; see normalizeDiscountAppliesTo.
                data.discount_applies_to ? JSON.stringify(data.discount_applies_to) : null,
                data.ex_charges         ?? 0,
                data.tip_amount         ?? 0,
                data.tip_added_to_salon ?? false,
                JSON.stringify(data.tip_breakdown ?? []),
                data.gst_percent        ?? 0,
                data.apply_membership_wallet ?? false,
                data.include_gst        ?? true,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateAppointmentBody): Promise<Appointment> {
        const JSONB_FIELDS = new Set(["services", "package_items", "product_items", "membership_items",
                                      "discount_applies_to", "tip_breakdown"]);

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

    // Deliberately does NOT bump updated_at — this is a pure status
    // transition (mark paid/partial/cancelled), never combined with an
    // actual content edit at any call site (see grep across
    // payments.service.ts/appointments.service.ts). needsTaxBackfill()
    // (appointments.service.ts) uses updated_at vs. the last payment's
    // created_at to decide whether a real edit happened AFTER that payment
    // and invalidated its frozen tax snapshot — recording the payment itself
    // always calls this right after, so if this touched updated_at too,
    // every single paid appointment would look "edited after payment" from
    // the moment it was paid, permanently defeating that check (this was a
    // real, shipped bug: an appointment paid with GST off would silently
    // pick up newly-enabled GST the next time it was merely viewed).
    async updateStatus(id: string, status: string, client?: import("pg").PoolClient): Promise<Appointment> {
        const db = client ?? pool;
        const { rows } = await db.query(
            `UPDATE appointments SET status = $2 WHERE id = $1 RETURNING *`,
            [id, status]
        );
        return rows[0];
    },

    // ─── Appointment Consumables (current-state, relational) ───────────────────
    // Deliberately a separate table rather than a field inside the `services`
    // JSONB column above — see appointment_service_consumables' migration
    // header comment for why (reporting: most-consumed products, avg usage
    // per service, staff/branch comparisons all need a plain GROUP BY here).

    async getServiceConsumables(appointmentId: string): Promise<AppointmentServiceConsumableRecord[]> {
        const { rows } = await pool.query(
            `SELECT asc_.service_row_id, asc_.service_id, asc_.product_id, p.name AS product_name,
                    asc_.standard_qty, asc_.actual_qty, asc_.entered_qty, asc_.unit, asc_.branch_id, asc_.staff_id
             FROM appointment_service_consumables asc_
             LEFT JOIN products p ON p.id = asc_.product_id
             WHERE asc_.appointment_id = $1`,
            [appointmentId]
        );
        return rows;
    },

    // Full replace (delete + reinsert), same convention as
    // servicesRepository.replaceConsumables / replaceStaff. Callers that need
    // the PRIOR state (to compute a deduct/return delta) must call
    // getServiceConsumables() before calling this — it does not return what
    // it deleted.
    async replaceServiceConsumables(appointmentId: string, rows: AppointmentServiceConsumableRecord[]): Promise<void> {
        await pool.query(`DELETE FROM appointment_service_consumables WHERE appointment_id = $1`, [appointmentId]);
        if (!rows.length) return;
        const values: unknown[] = [];
        const rowsSql: string[] = [];
        rows.forEach((r, i) => {
            const base = i * 10;
            values.push(
                appointmentId, r.service_row_id, r.service_id ?? null, r.product_id,
                r.standard_qty, r.actual_qty, r.entered_qty ?? null, r.unit ?? null, r.branch_id ?? null, r.staff_id ?? null
            );
            rowsSql.push(
                `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
            );
        });
        await pool.query(
            `INSERT INTO appointment_service_consumables
               (appointment_id, service_row_id, service_id, product_id, standard_qty, actual_qty, entered_qty, unit, branch_id, staff_id)
             VALUES ${rowsSql.join(", ")}`,
            values
        );
    },

    // Bulk-flips overdue, never-paid appointments to no-show. Deliberately
    // scoped to `status = 'booked'` only — a `partial` appointment (deposit
    // already paid) is left alone even once its time passes, so staff can
    // still resolve the remaining due manually instead of it silently
    // reclassifying as a no-show.
    async markNoShowBatch(): Promise<{ id: string; salon_id: string }[]> {
        const { rows } = await pool.query(
            `UPDATE appointments
             SET status = 'no-show', updated_at = NOW()
             WHERE status = 'booked' AND ends_at < NOW() AND deleted_at IS NULL
             RETURNING id, salon_id`
        );
        return rows;
    },

    // True hard delete — permanently removes the appointment and every
    // financial record tied to it (commissions earned, payments, the linked
    // sale and its line items) in one transaction, so nothing is left behind
    // that could still be counted in revenue/commission totals. Runs before
    // the appointments row itself so FK lookups via sale_id still resolve.
    async deleteById(id: string): Promise<Appointment | null> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: apptRows } = await client.query(
                `SELECT * FROM appointments WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const appointment = apptRows[0];
            if (!appointment) {
                await client.query('ROLLBACK');
                return null;
            }
            const saleId: string | null = appointment.sale_id ?? null;

            await client.query(
                `DELETE FROM commission_earned WHERE appointment_id = $1 OR ($2::uuid IS NOT NULL AND sale_id = $2)`,
                [id, saleId]
            );
            await client.query(`DELETE FROM payments WHERE appointment_id = $1`, [id]);
            if (saleId) {
                await client.query(`DELETE FROM sale_items WHERE sale_id = $1`, [saleId]);
                await client.query(`DELETE FROM sales WHERE id = $1`, [saleId]);
            } else {
                await client.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE appointment_id = $1)`, [id]);
                await client.query(`DELETE FROM sales WHERE appointment_id = $1`, [id]);
            }
            const { rows } = await client.query(
                `DELETE FROM appointments WHERE id = $1 RETURNING *`,
                [id]
            );
            await client.query('COMMIT');
            return rows[0] || null;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    // Same reasoning as updateStatus() above for not touching updated_at —
    // this is the checkout-time status flip, not a content edit.
    async linkSale(id: string, saleId: string): Promise<Appointment> {
        const { rows } = await pool.query(
            `UPDATE appointments
             SET sale_id = $2, status = 'paid'
             WHERE id = $1 RETURNING *`,
            [id, saleId]
        );
        return rows[0];
    },

    // Clears a stale sale_id reference (e.g. the sale it pointed at was
    // hard-deleted) so checkout can fall through and create a fresh one
    // instead of permanently refusing with "already has a linked sale".
    async clearSaleId(id: string): Promise<void> {
        await pool.query(
            `UPDATE appointments SET sale_id = NULL, updated_at = NOW() WHERE id = $1`,
            [id]
        );
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