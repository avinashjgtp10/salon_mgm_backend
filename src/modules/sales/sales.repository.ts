import pool, { safeQuery } from "../../config/database";
import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody } from "./sales.types";
import { getTaxModuleConfig } from "../settings/tax.util";

function parseCreatedAt(input: string | undefined | null): Date {
    if (!input) return new Date();
    if (input.includes('T') || /\d{4}-\d{2}-\d{2}T/.test(input)) return new Date(input);
    return new Date(input + 'T00:00:00.000Z');
}

export const salesRepository = {
    async findById(id: string): Promise<Sale | null> {
        const { rows } = await safeQuery(() => pool.query(
            `SELECT s.*,
                    c.full_name         AS client_name,
                    c.phone_number      AS client_phone,
                    c.phone_country_code AS client_phone_code,
                    sal.business_name   AS salon_name
             FROM sales s
             LEFT JOIN clients c   ON s.client_id = c.id
             LEFT JOIN salons  sal ON s.salon_id   = sal.id
             WHERE s.id = $1`,
            [id]
        ));
        return rows[0] || null;
    },

    async findByAppointmentId(appointmentId: string): Promise<Sale | null> {
        const { rows } = await safeQuery(() => pool.query(
            `SELECT * FROM sales WHERE appointment_id = $1 LIMIT 1`,
            [appointmentId]
        ));
        return rows[0] || null;
    },

    async findItemsBySaleId(saleId: string): Promise<SaleItem[]> {
        const { rows } = await safeQuery(() => pool.query(
            `SELECT si.id, si.sale_id, si.item_type, si.item_id,
                    COALESCE(si.staff_id, s.staff_id) AS staff_id,
                    si.name, si.quantity, si.unit_price, si.discount_amount, si.total_price,
                    si.tax_amount, si.taxable_amount, si.created_at
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE si.sale_id = $1`,
            [saleId]
        ));
        return rows;
    },

    // Batched form of findItemsBySaleId — one query for a whole list of sale
    // ids (e.g. every linked sale in a calendar day's appointment list),
    // grouped by sale_id, instead of one DB round-trip per appointment.
    async findItemsBySaleIds(saleIds: string[]): Promise<Map<string, SaleItem[]>> {
        const result = new Map<string, SaleItem[]>();
        if (saleIds.length === 0) return result;
        const { rows } = await safeQuery(() => pool.query(
            `SELECT si.id, si.sale_id, si.item_type, si.item_id,
                    COALESCE(si.staff_id, s.staff_id) AS staff_id,
                    si.name, si.quantity, si.unit_price, si.discount_amount, si.total_price,
                    si.tax_amount, si.taxable_amount, si.created_at
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE si.sale_id = ANY($1::uuid[])`,
            [saleIds]
        ));
        rows.forEach((row: SaleItem) => {
            const list = result.get(row.sale_id) ?? [];
            list.push(row);
            result.set(row.sale_id, list);
        });
        return result;
    },

    async list(filters: {
        salon_id?: string; client_id?: string; status?: string; staff_id?: string;
        start_date?: string; end_date?: string; page?: number; limit?: number;
    }): Promise<{ items: Sale[]; pagination: { total: number; page: number; limit: number; total_pages: number } }> {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`s.salon_id = $${idx++}`); values.push(filters.salon_id); }
        if (filters.client_id) { conditions.push(`s.client_id = $${idx++}`); values.push(filters.client_id); }
        if (filters.status) { conditions.push(`s.status = $${idx++}`); values.push(filters.status); }
        if (filters.staff_id) { conditions.push(`s.staff_id = $${idx++}`); values.push(filters.staff_id); }
        if (filters.start_date) { conditions.push(`s.created_at >= $${idx++}::date`); values.push(filters.start_date); }
        if (filters.end_date) { conditions.push(`s.created_at < ($${idx++}::date + interval '1 day')`); values.push(filters.end_date); }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        // No limit passed => keep pre-existing "fetch everything" behavior
        // (some callers, e.g. revenue aggregates, need the full result set).
        const page = Math.max(1, Number(filters.page ?? 1));
        const limit = filters.limit ? Math.max(1, Number(filters.limit)) : undefined;
        const offset = limit ? (page - 1) * limit : 0;
        const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
        if (limit) values.push(limit, offset);

        const query = `SELECT s.*, c.full_name AS client_name, COUNT(*) OVER() AS total_count
                       FROM sales s
                       LEFT JOIN clients c ON s.client_id = c.id
                       ${whereClause}
                       ORDER BY s.created_at DESC
                       ${limitClause}`;
        const { rows } = await safeQuery(() => pool.query(query, values));
        const total = rows.length ? Number(rows[0].total_count) : 0;
        const items = rows.map(({ total_count, ...r }) => r);
        const effectiveLimit = limit ?? Math.max(total, 1);
        return { items, pagination: { total, page, limit: effectiveLimit, total_pages: Math.max(1, Math.ceil(total / effectiveLimit)) } };
    },

    // ── Service/product line items performed by a single staff member ──────────
    // (for the Staff History "Services" tab — item_type filter narrows to just
    // services when needed; staff attribution falls back to the sale's own
    // staff_id when the line item itself has none, matching the same COALESCE
    // pattern used by findItemsBySaleId/commission calculation.)
    async listItemsByStaff(
        salonId: string,
        staffId: string,
        filters: { item_type?: string; start_date?: string; end_date?: string; page?: number; limit?: number } = {}
    ): Promise<{
        items: (SaleItem & { sale_created_at: string; client_name: string | null; payment_source: string })[];
        pagination: { total: number; page: number; limit: number; total_pages: number };
    }> {
        const conditions: string[] = [`s.salon_id = $1`, `COALESCE(si.staff_id, s.staff_id) = $2`];
        const values: any[] = [salonId, staffId];
        let idx = 3;

        if (filters.item_type) { conditions.push(`si.item_type = $${idx++}`); values.push(filters.item_type); }
        if (filters.start_date) { conditions.push(`s.created_at >= $${idx++}::date`); values.push(filters.start_date); }
        if (filters.end_date) { conditions.push(`s.created_at < ($${idx++}::date + interval '1 day')`); values.push(filters.end_date); }

        const page = Math.max(1, Number(filters.page ?? 1));
        const limit = filters.limit ? Math.max(1, Number(filters.limit)) : undefined;
        const offset = limit ? (page - 1) * limit : 0;
        const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
        if (limit) values.push(limit, offset);

        // payment_source = where this specific line item's value came from.
        // Item-level coverage (membership wallet, package) takes precedence — it's
        // tied to this exact item via membership_usage_log / appointments.services —
        // and everything else falls back to the sale's payment method (Cash/Card/
        // UPI/Split/eWallet…). mship/pkg are correlated EXISTS-style lateral joins
        // keyed on service_id (which also holds a product's id for a product
        // redemption — see client-memberships.repository.ts deductWalletAcrossMemberships).
        const { rows } = await safeQuery(() => pool.query(
            `SELECT si.id, si.sale_id, si.item_type, si.item_id,
                    COALESCE(si.staff_id, s.staff_id) AS staff_id,
                    si.name, si.quantity, si.unit_price, si.discount_amount, si.total_price,
                    si.tax_amount, si.taxable_amount, si.created_at,
                    s.created_at AS sale_created_at,
                    c.full_name  AS client_name,
                    CASE
                      WHEN mship.hit IS NOT NULL THEN 'Membership'
                      WHEN pkg.hit   IS NOT NULL THEN 'Package'
                      ELSE COALESCE(NULLIF(TRIM(s.payment_method), ''), '—')
                    END AS payment_source,
                    COUNT(*) OVER() AS total_count
             FROM sale_items si
             JOIN sales s   ON si.sale_id = s.id
             LEFT JOIN clients c ON s.client_id = c.id
             LEFT JOIN LATERAL (
               SELECT 1 AS hit FROM membership_usage_log mul
               WHERE mul.appointment_id = s.appointment_id
                 AND mul.service_id::text = si.item_id::text
               LIMIT 1
             ) mship ON TRUE
             LEFT JOIN LATERAL (
               SELECT 1 AS hit
               FROM appointments a
               CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) svc
               WHERE a.id = s.appointment_id
                 AND (svc->>'service_id') = si.item_id::text
                 AND COALESCE((svc->>'is_package_service')::boolean, FALSE) = TRUE
               LIMIT 1
             ) pkg ON TRUE
             WHERE ${conditions.join(" AND ")}
             ORDER BY s.created_at DESC
             ${limitClause}`,
            values
        ));
        const total = rows.length ? Number(rows[0].total_count) : 0;
        const items = rows.map(({ total_count, ...r }) => r);
        const effectiveLimit = limit ?? Math.max(total, 1);
        return { items, pagination: { total, page, limit: effectiveLimit, total_pages: Math.max(1, Math.ceil(total / effectiveLimit)) } };
    },

    async getDailySummary(salonId: string, date?: string): Promise<{ total: string; count: string }> {
        if (date) {
            const { rows } = await safeQuery(() => pool.query(
                `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
                 FROM sales WHERE salon_id = $1 AND DATE(created_at) = $2 AND status = 'completed'`,
                [salonId, date]
            ));
            return { total: rows[0].total.toString(), count: rows[0].count.toString() };
        }
        const { rows } = await safeQuery(() => pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
             FROM sales WHERE salon_id = $1 AND status = 'completed'`,
            [salonId]
        ));
        return { total: rows[0].total.toString(), count: rows[0].count.toString() };
    },

    async deleteById(id: string): Promise<Sale | null> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM sale_items WHERE sale_id = $1`, [id]);
            const { rows } = await client.query(`DELETE FROM sales WHERE id = $1 RETURNING *`, [id]);
            await client.query('COMMIT');
            return rows[0] || null;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    async create(data: CreateSaleBody, createdBy: string | null): Promise<Sale> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Two independent call sites can race to create the sale for the same
            // appointment (payments.service.ts's auto-create-on-completed-payment,
            // and appointments.service.ts's checkout -> recordTransaction, fired
            // back-to-back by usePayment.ts without awaiting one before the other).
            // recordTransaction's own findByAppointmentId check happens BEFORE this
            // transaction starts, so it can't see a sale the other request is still
            // mid-COMMIT on. Lock on the appointment id here so the second caller
            // blocks until the first's transaction finishes, then re-check for an
            // existing sale inside the lock before inserting a duplicate.
            if (data.appointment_id) {
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [data.appointment_id]);
                const { rows: dupRows } = await client.query(
                    `SELECT id FROM sales WHERE appointment_id = $1 LIMIT 1`,
                    [data.appointment_id]
                );
                if (dupRows[0]) {
                    await client.query('COMMIT');
                    const existing = await this.findById(dupRows[0].id);
                    if (existing) return existing;
                }
            }

            let subtotal = 0;
            data.items.forEach(item => {
                const discAmt = item.discount_amount ? parseFloat(item.discount_amount) : 0;
                subtotal += item.quantity * parseFloat(item.unit_price) - discAmt;
            });
            const discountAmt = data.discount_amount ? parseFloat(data.discount_amount) : 0;
            const taxAmt      = data.tax_amount      ? parseFloat(data.tax_amount)      : 0;
            const exChargesAmt = data.ex_charges     ? parseFloat(data.ex_charges)      : 0;
            // tip_amount is still stored as its own column (below) but deliberately
            // excluded from this total — it passes through to staff, not
            // the salon, so it must never count as revenue. ex_charges DOES count
            // (a client-facing surcharge the business actually keeps), unlike tip.
            const total = subtotal - discountAmt + taxAmt + exChargesAmt;
            const { invoice_prefix } = await getTaxModuleConfig(data.salon_id);
            const createdAtVal = parseCreatedAt(data.created_at);

            // Per-salon sequential invoice numbers (1, 2, 3, ...). The UPDATE...
            // RETURNING serializes on the salon's own row under Postgres row-level
            // locking, so concurrent inserts for the same salon never READ the same
            // sequence number. But next_invoice_seq can still drift behind reality
            // (e.g. a row was inserted directly, or a prior attempt's INSERT failed
            // for an unrelated reason after the counter had already been bumped by
            // an earlier successful transaction that this one didn't know about) —
            // if the resulting invoice_number collides with one already used
            // (sales_invoice_number_salon_key), bump the counter again and retry
            // rather than failing the whole sale outright.
            let sale: any;
            for (let attempt = 0; ; attempt++) {
                const { rows: seqRows } = await client.query(
                    `UPDATE salons SET next_invoice_seq = next_invoice_seq + 1
                     WHERE id = $1 RETURNING next_invoice_seq - 1 AS seq`,
                    [data.salon_id]
                );
                const seq = seqRows[0].seq;
                const invoiceNumber = `${invoice_prefix || "INV"}-${String(seq).padStart(5, "0")}`;

                // SAVEPOINT so a collision here only unwinds this one INSERT —
                // without it, Postgres marks the whole transaction aborted on
                // error, and the next loop iteration's UPDATE would fail too.
                await client.query('SAVEPOINT sale_insert_attempt');
                try {
                    const saleResult = await client.query(
                        `INSERT INTO sales (
                            salon_id, client_id, appointment_id, staff_id, status, subtotal,
                            discount_amount, tip_amount, tax_amount, ex_charges, total_amount, payment_method,
                            payment_reference, notes, invoice_number, created_by, created_at,
                            coupon_code, discount_percent, discount_type
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
                        [
                            data.salon_id, data.client_id || null, data.appointment_id || null, data.staff_id || null,
                            data.status || 'draft', subtotal.toString(), data.discount_amount || '0',
                            data.tip_amount || '0', data.tax_amount || '0', data.ex_charges || '0', total.toString(),
                            data.payment_method ? data.payment_method.toLowerCase() : null, data.payment_reference || null, data.notes || null,
                            invoiceNumber, createdBy, createdAtVal,
                            data.coupon_code || null, data.discount_percent || null, data.discount_type || null,
                        ]
                    );
                    await client.query('RELEASE SAVEPOINT sale_insert_attempt');
                    sale = saleResult.rows[0];
                    break;
                } catch (insertErr: any) {
                    await client.query('ROLLBACK TO SAVEPOINT sale_insert_attempt');
                    const isInvoiceCollision = insertErr?.code === '23505'
                        && insertErr?.constraint === 'sales_invoice_number_salon_key';
                    if (!isInvoiceCollision || attempt >= 5) throw insertErr;
                    // Retry with a fresh sequence number — the loop's next
                    // iteration re-reads/re-increments next_invoice_seq.
                }
            }

            for (const item of data.items) {
                const discAmt       = item.discount_amount ? parseFloat(item.discount_amount) : 0;
                const itemTotal     = item.quantity * parseFloat(item.unit_price) - discAmt;
                await client.query(
                    `INSERT INTO sale_items (
                        sale_id, item_type, item_id, staff_id, name, quantity, unit_price, discount_amount, total_price, tax_amount, taxable_amount
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    [sale.id, item.item_type, item.item_id || null, item.staff_id || null,
                     item.name, item.quantity, item.unit_price, item.discount_amount || '0', itemTotal.toString(),
                     item.tax_amount || '0', item.taxable_amount || '0']
                );
            }

            await client.query('COMMIT');
            return sale;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    async update(id: string, patch: UpdateSaleBody): Promise<Sale> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { items, ...salePatch } = patch;

            // If items are provided: replace all items and recalculate totals
            if (items && items.length > 0) {
                await client.query(`DELETE FROM sale_items WHERE sale_id = $1`, [id]);

                let subtotal = 0;
                for (const item of items) {
                    const discAmt   = item.discount_amount ? parseFloat(item.discount_amount) : 0;
                    const itemTotal = item.quantity * parseFloat(item.unit_price) - discAmt;
                    subtotal += itemTotal;
                    await client.query(
                        `INSERT INTO sale_items (
                            sale_id, item_type, item_id, staff_id, name, quantity, unit_price, discount_amount, total_price, tax_amount, taxable_amount
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                        [id, item.item_type, item.item_id || null, item.staff_id || null,
                         item.name, item.quantity, item.unit_price, item.discount_amount || '0', itemTotal.toString(),
                         item.tax_amount || '0', item.taxable_amount || '0']
                    );
                }

                const discountAmt  = salePatch.discount_amount ? parseFloat(salePatch.discount_amount) : 0;
                const taxAmt       = salePatch.tax_amount      ? parseFloat(salePatch.tax_amount)      : 0;
                const exChargesAmt = salePatch.ex_charges      ? parseFloat(salePatch.ex_charges)      : 0;
                // tip_amount excluded from total — see create()'s comment.
                const total        = subtotal - discountAmt + taxAmt + exChargesAmt;

                const setParts: string[] = ['subtotal = $1', 'total_amount = $2', 'updated_at = NOW()'];
                const values: any[]      = [subtotal.toString(), total.toString()];
                let idx = 3;

                const extraFields = ['client_id', 'discount_amount', 'tip_amount', 'tax_amount', 'ex_charges', 'notes', 'status', 'payment_method', 'payment_reference', 'created_at'];
                for (const key of extraFields) {
                    if (key in salePatch && (salePatch as any)[key] !== undefined) {
                        setParts.push(`${key} = $${idx++}`);
                        const val = key === 'created_at'
                            ? parseCreatedAt((salePatch as any)[key])
                            : key === 'payment_method' && typeof (salePatch as any)[key] === 'string'
                            ? (salePatch as any)[key].toLowerCase()
                            : (salePatch as any)[key];
                        values.push(val);
                    }
                }
                values.push(id);

                const { rows } = await client.query(
                    `UPDATE sales SET ${setParts.join(', ')} WHERE id = $${idx} RETURNING *`,
                    values
                );
                await client.query('COMMIT');
                return rows[0];
            }

            // No items — just patch sale-level fields
            const keys = Object.keys(salePatch) as (keyof typeof salePatch)[];
            if (keys.length === 0) {
                const { rows } = await client.query(`SELECT * FROM sales WHERE id = $1`, [id]);
                await client.query('COMMIT');
                return rows[0];
            }

            const setParts: string[] = [];
            const values: any[]      = [];
            keys.forEach((k, i) => {
                setParts.push(`${String(k)} = $${i + 1}`);
                const val = k === 'created_at'
                    ? parseCreatedAt((salePatch as any)[k])
                    : k === 'payment_method' && typeof (salePatch as any)[k] === 'string'
                    ? (salePatch as any)[k].toLowerCase()
                    : (salePatch as any)[k];
                values.push(val);
            });
            setParts.push(`updated_at = NOW()`);
            values.push(id);

            const { rows } = await client.query(
                `UPDATE sales SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
                values
            );
            await client.query('COMMIT');
            return rows[0];
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    async checkout(id: string, params: { payment_method: string; payment_reference?: string; status?: "completed" }): Promise<Sale> {
        const { rows } = await safeQuery(() => pool.query(
            `UPDATE sales SET payment_method = $2, payment_reference = $3, status = $4, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id, params.payment_method?.toLowerCase() ?? null, params.payment_reference || null, params.status || 'completed']
        ));
        return rows[0];
    },

    async exportList(filters: { salon_id?: string; status?: string; date?: string }): Promise<Sale[]> {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`salon_id = $${idx++}`);          values.push(filters.salon_id); }
        if (filters.status)   { conditions.push(`status = $${idx++}`);             values.push(filters.status);   }
        if (filters.date)     { conditions.push(`DATE(created_at) = $${idx++}`);   values.push(filters.date);     }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const query = `SELECT * FROM sales ${whereClause} ORDER BY created_at DESC`;
        const { rows } = await safeQuery(() => pool.query(query, values));
        return rows;
    }
};