import pool from "../../config/database";
import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody } from "./sales.types";

export const salesRepository = {
    async findById(id: string): Promise<Sale | null> {
        const { rows } = await pool.query(`SELECT * FROM sales WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async findItemsBySaleId(saleId: string): Promise<SaleItem[]> {
        const { rows } = await pool.query(`SELECT * FROM sale_items WHERE sale_id = $1`, [saleId]);
        return rows;
    },

    async list(filters: { salon_id?: string; client_id?: string; status?: string }): Promise<Sale[]> {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`salon_id = $${idx++}`); values.push(filters.salon_id); }
        if (filters.client_id) { conditions.push(`client_id = $${idx++}`); values.push(filters.client_id); }
        if (filters.status) { conditions.push(`status = $${idx++}`); values.push(filters.status); }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const query = `SELECT * FROM sales ${whereClause} ORDER BY created_at DESC`;
        const { rows } = await pool.query(query, values);
        return rows;
    },

    async getDailySummary(salonId: string, date: string): Promise<{ total: string; count: string }> {
        const { rows } = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count 
             FROM sales WHERE salon_id = $1 AND DATE(created_at) = $2 AND status = 'completed'`,
            [salonId, date]
        );
        return { total: rows[0].total.toString(), count: rows[0].count.toString() };
    },

    async create(data: CreateSaleBody, createdBy: string | null): Promise<Sale> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Generate basic total values
            let subtotal = 0;
            data.items.forEach(item => {
                subtotal += item.quantity * parseFloat(item.unit_price);
            });
            const discountAmt = data.discount_amount ? parseFloat(data.discount_amount) : 0;
            const taxAmt = data.tax_amount ? parseFloat(data.tax_amount) : 0;
            const tipAmt = data.tip_amount ? parseFloat(data.tip_amount) : 0;
            const total = subtotal - discountAmt + taxAmt + tipAmt;

            const invoiceNumber = `INV-${Date.now()}`;

            const saleResult = await client.query(
                `INSERT INTO sales (
                    salon_id, client_id, appointment_id, staff_id, status, subtotal, 
                    discount_amount, tip_amount, tax_amount, total_amount, payment_method, 
                    payment_reference, notes, invoice_number, created_by
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
                [
                    data.salon_id, data.client_id || null, data.appointment_id || null, data.staff_id || null,
                    data.status || 'draft', subtotal.toString(), data.discount_amount || '0',
                    data.tip_amount || '0', data.tax_amount || '0', total.toString(),
                    data.payment_method || null, data.payment_reference || null, data.notes || null,
                    invoiceNumber, createdBy
                ]
            );
            const sale = saleResult.rows[0];

            for (const item of data.items) {
                const item_total_price = item.quantity * parseFloat(item.unit_price);
                await client.query(
                    `INSERT INTO sale_items (
                        sale_id, item_type, item_id, name, quantity, unit_price, total_price
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [sale.id, item.item_type, item.item_id || null, item.name, item.quantity, item.unit_price, item_total_price.toString()]
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
        const keys = Object.keys(patch) as (keyof UpdateSaleBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM sales WHERE id = $1`, [id]);
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
            `UPDATE sales SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
            values
        );
        return rows[0];
    },

    async checkout(id: string, params: { payment_method: string; payment_reference?: string; status?: "completed" }): Promise<Sale> {
        const { rows } = await pool.query(
            `UPDATE sales SET payment_method = $2, payment_reference = $3, status = $4, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id, params.payment_method, params.payment_reference || null, params.status || 'completed']
        );
        return rows[0];
    },

    async exportList(filters: { salon_id?: string; status?: string }): Promise<Sale[]> {
        const conditions: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`salon_id = $${idx++}`); values.push(filters.salon_id); }
        if (filters.status)   { conditions.push(`status = $${idx++}`);   values.push(filters.status);   }

        const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const query = `SELECT * FROM sales ${whereClause} ORDER BY created_at DESC`;
        const { rows } = await pool.query(query, values);
        return rows;
    }
};
