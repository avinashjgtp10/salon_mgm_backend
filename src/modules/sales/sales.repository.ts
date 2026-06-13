import pool, { safeQuery } from "../../config/database";
import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody } from "./sales.types";

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
                    si.name, si.quantity, si.unit_price, si.discount_amount, si.total_price, si.created_at
             FROM sale_items si
             JOIN sales s ON si.sale_id = s.id
             WHERE si.sale_id = $1`,
            [saleId]
        ));
        return rows;
    },

    async list(filters: { salon_id?: string; client_id?: string; status?: string }): Promise<Sale[]> {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`s.salon_id = $${idx++}`); values.push(filters.salon_id); }
        if (filters.client_id) { conditions.push(`s.client_id = $${idx++}`); values.push(filters.client_id); }
        if (filters.status) { conditions.push(`s.status = $${idx++}`); values.push(filters.status); }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const query = `SELECT s.*, c.full_name AS client_name
                       FROM sales s
                       LEFT JOIN clients c ON s.client_id = c.id
                       ${whereClause}
                       ORDER BY s.created_at DESC`;
        const { rows } = await safeQuery(() => pool.query(query, values));
        return rows;
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

            let subtotal = 0;
            data.items.forEach(item => {
                const discAmt = item.discount_amount ? parseFloat(item.discount_amount) : 0;
                subtotal += item.quantity * parseFloat(item.unit_price) - discAmt;
            });
            const discountAmt = data.discount_amount ? parseFloat(data.discount_amount) : 0;
            const taxAmt      = data.tax_amount      ? parseFloat(data.tax_amount)      : 0;
            const tipAmt      = data.tip_amount      ? parseFloat(data.tip_amount)      : 0;
            const total = subtotal - discountAmt + taxAmt + tipAmt;

            const invoiceNumber = `INV-${Date.now()}`;
            const createdAtVal = parseCreatedAt(data.created_at);

            const saleResult = await client.query(
                `INSERT INTO sales (
                    salon_id, client_id, appointment_id, staff_id, status, subtotal,
                    discount_amount, tip_amount, tax_amount, total_amount, payment_method,
                    payment_reference, notes, invoice_number, created_by, created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
                [
                    data.salon_id, data.client_id || null, data.appointment_id || null, data.staff_id || null,
                    data.status || 'draft', subtotal.toString(), data.discount_amount || '0',
                    data.tip_amount || '0', data.tax_amount || '0', total.toString(),
                    data.payment_method || null, data.payment_reference || null, data.notes || null,
                    invoiceNumber, createdBy, createdAtVal,
                ]
            );
            const sale = saleResult.rows[0];

            for (const item of data.items) {
                const discAmt       = item.discount_amount ? parseFloat(item.discount_amount) : 0;
                const itemTotal     = item.quantity * parseFloat(item.unit_price) - discAmt;
                await client.query(
                    `INSERT INTO sale_items (
                        sale_id, item_type, item_id, staff_id, name, quantity, unit_price, discount_amount, total_price
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [sale.id, item.item_type, item.item_id || null, item.staff_id || null,
                     item.name, item.quantity, item.unit_price, item.discount_amount || '0', itemTotal.toString()]
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
                            sale_id, item_type, item_id, staff_id, name, quantity, unit_price, discount_amount, total_price
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                        [id, item.item_type, item.item_id || null, item.staff_id || null,
                         item.name, item.quantity, item.unit_price, item.discount_amount || '0', itemTotal.toString()]
                    );
                }

                const discountAmt = salePatch.discount_amount ? parseFloat(salePatch.discount_amount) : 0;
                const taxAmt      = salePatch.tax_amount      ? parseFloat(salePatch.tax_amount)      : 0;
                const tipAmt      = salePatch.tip_amount      ? parseFloat(salePatch.tip_amount)      : 0;
                const total       = subtotal - discountAmt + taxAmt + tipAmt;

                const setParts: string[] = ['subtotal = $1', 'total_amount = $2', 'updated_at = NOW()'];
                const values: any[]      = [subtotal.toString(), total.toString()];
                let idx = 3;

                const extraFields = ['client_id', 'discount_amount', 'tip_amount', 'tax_amount', 'notes', 'status', 'payment_method', 'payment_reference', 'created_at'];
                for (const key of extraFields) {
                    if (key in salePatch && (salePatch as any)[key] !== undefined) {
                        setParts.push(`${key} = $${idx++}`);
                        const val = key === 'created_at'
                            ? parseCreatedAt((salePatch as any)[key])
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
            [id, params.payment_method, params.payment_reference || null, params.status || 'completed']
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