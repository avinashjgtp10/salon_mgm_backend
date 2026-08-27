import pool from "../../config/database";
import { CreateOrderDTO, ListOrderFilters, Order, OrderItem, OrderSignature } from "./orders.types";

// Schema (orders, order_items, order_signatures, salons.next_order_seq) is
// NOT self-migrated from here — per project policy, schema changes are never
// auto-run. See Migration/create_orders_tables.sql; run it by hand against
// each environment before using this module.

export const ordersRepository = {
    /**
     * Records a purchase order as a standalone document — header + line
     * items, its own sequential order number. Unlike purchasesRepository's
     * create(), this never touches products.amount or stock_movements: an
     * Order precedes receiving, it doesn't record a delivery.
     *
     * Per-line math (see NewOrderPage): discount_percent is a percentage,
     * cost_price is entered tax-exclusive so cost_wo_tax === cost_price,
     * total_cost_wo_tax = cost_wo_tax * qty, and total_tax is that same base
     * multiplied by the order's flat tax_rate (Tax Group's rate, not a
     * per-line rate — see CreateOrderDTO.tax_rate).
     */
    async create(data: CreateOrderDTO, salonId: string, createdBy: string): Promise<Order> {
        const taxRate = data.tax_rate ?? 0;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Per-salon sequential order numbers — same retry pattern as
            // purchasesRepository.create()'s purchase_number generation.
            let order: any;
            for (let attempt = 0; ; attempt++) {
                const { rows: seqRows } = await client.query(
                    `UPDATE salons SET next_order_seq = next_order_seq + 1
                     WHERE id = $1 RETURNING next_order_seq - 1 AS seq`,
                    [salonId],
                );
                const seq = seqRows[0].seq;
                const orderNumber = `ORD-${String(seq).padStart(5, "0")}`;

                await client.query("SAVEPOINT order_insert_attempt");
                try {
                    const orderResult = await client.query(
                        `INSERT INTO orders (
                           salon_id, order_number, supplier_id,
                           bill_to_branch_id, ship_to_branch_id, order_date,
                           remark, ref_number, payment_terms_days,
                           shipment_date, delivery_date,
                           tax_type, tax_group, terms_conditions, signature_url,
                           shipping_cost, created_by
                         ) VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                         RETURNING *`,
                        [
                            salonId, orderNumber, data.supplier_id,
                            data.bill_to_branch_id ?? null, data.ship_to_branch_id ?? null, data.order_date ?? null,
                            data.remark ?? null, data.ref_number ?? null, data.payment_terms_days ?? null,
                            data.shipment_date ?? null, data.delivery_date ?? null,
                            data.tax_type, data.tax_group ?? null, data.terms_conditions ?? null, data.signature_url ?? null,
                            data.shipping_cost ?? 0, createdBy,
                        ],
                    );
                    await client.query("RELEASE SAVEPOINT order_insert_attempt");
                    order = orderResult.rows[0];
                    break;
                } catch (insertErr: any) {
                    await client.query("ROLLBACK TO SAVEPOINT order_insert_attempt");
                    const isCollision = insertErr?.code === "23505"
                        && insertErr?.constraint === "orders_salon_id_order_number_key";
                    if (!isCollision || attempt >= 5) throw insertErr;
                }
            }

            let totalQuantity = 0;
            let totalPrice = 0;
            const items: OrderItem[] = [];

            for (const item of data.items) {
                const discountPercent = item.discount_percent ?? 0;
                const costWoTax = item.cost_price;
                const totalCostWoTax = costWoTax * item.qty;
                const totalTax = totalCostWoTax * (taxRate / 100);
                const lineSellingTotal = item.selling_price * item.qty * (1 - discountPercent / 100);

                totalQuantity += item.qty;
                totalPrice += lineSellingTotal;

                const { rows: itemRows } = await client.query(
                    `INSERT INTO order_items (
                       order_id, product_id, product_code, qty, selling_price,
                       discount_percent, cost_price, cost_wo_tax, total_cost_wo_tax, total_tax
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                     RETURNING *`,
                    [
                        order.id, item.product_id, item.product_code ?? null, item.qty, item.selling_price,
                        discountPercent, item.cost_price, costWoTax, totalCostWoTax, totalTax,
                    ],
                );
                items.push(itemRows[0]);
            }

            // total_price is the grand total shown as "TOTAL" in the Order
            // Summary — line totals (after per-line discount) plus tax and
            // shipping, not just the raw line subtotal.
            const totalTaxAmount = items.reduce((sum, item) => sum + Number(item.total_tax), 0);
            const shippingCost = data.shipping_cost ?? 0;
            const grandTotal = totalPrice + totalTaxAmount + shippingCost;

            const { rows: updatedOrderRows } = await client.query(
                `UPDATE orders SET total_quantity = $1, total_price = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
                [totalQuantity, grandTotal, order.id],
            );
            order = updatedOrderRows[0];

            await client.query("COMMIT");
            return { ...order, items };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Replaces an order's header fields and line items in one transaction —
     * order_number and created_by are never touched. Items are deleted and
     * re-inserted rather than diffed line-by-line (same "whole document"
     * mental model as create()); totals are recomputed with the exact same
     * math so an edited order's Order Summary can't drift from a fresh one's.
     */
    async update(id: string, data: CreateOrderDTO, salonId: string): Promise<Order | null> {
        const taxRate = data.tax_rate ?? 0;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: existingRows } = await client.query(
                `SELECT id FROM orders WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [id, salonId],
            );
            if (!existingRows.length) {
                await client.query("ROLLBACK");
                return null;
            }

            await client.query(
                `UPDATE orders SET
                   supplier_id = $1, bill_to_branch_id = $2, ship_to_branch_id = $3,
                   order_date = COALESCE($4, order_date), remark = $5, ref_number = $6,
                   payment_terms_days = $7, shipment_date = $8, delivery_date = $9,
                   tax_type = $10, tax_group = $11, terms_conditions = $12,
                   signature_url = $13, shipping_cost = $14, updated_at = NOW()
                 WHERE id = $15`,
                [
                    data.supplier_id, data.bill_to_branch_id ?? null, data.ship_to_branch_id ?? null,
                    data.order_date ?? null, data.remark ?? null, data.ref_number ?? null,
                    data.payment_terms_days ?? null, data.shipment_date ?? null, data.delivery_date ?? null,
                    data.tax_type, data.tax_group ?? null, data.terms_conditions ?? null,
                    data.signature_url ?? null, data.shipping_cost ?? 0, id,
                ],
            );

            await client.query(`DELETE FROM order_items WHERE order_id = $1`, [id]);

            let totalQuantity = 0;
            let totalPrice = 0;
            const items: OrderItem[] = [];

            for (const item of data.items) {
                const discountPercent = item.discount_percent ?? 0;
                const costWoTax = item.cost_price;
                const totalCostWoTax = costWoTax * item.qty;
                const totalTax = totalCostWoTax * (taxRate / 100);
                const lineSellingTotal = item.selling_price * item.qty * (1 - discountPercent / 100);

                totalQuantity += item.qty;
                totalPrice += lineSellingTotal;

                const { rows: itemRows } = await client.query(
                    `INSERT INTO order_items (
                       order_id, product_id, product_code, qty, selling_price,
                       discount_percent, cost_price, cost_wo_tax, total_cost_wo_tax, total_tax
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                     RETURNING *`,
                    [
                        id, item.product_id, item.product_code ?? null, item.qty, item.selling_price,
                        discountPercent, item.cost_price, costWoTax, totalCostWoTax, totalTax,
                    ],
                );
                items.push(itemRows[0]);
            }

            const totalTaxAmount = items.reduce((sum, item) => sum + Number(item.total_tax), 0);
            const shippingCost = data.shipping_cost ?? 0;
            const grandTotal = totalPrice + totalTaxAmount + shippingCost;

            const { rows: updatedOrderRows } = await client.query(
                `UPDATE orders SET total_quantity = $1, total_price = $2, updated_at = NOW()
                 WHERE id = $3 RETURNING *`,
                [totalQuantity, grandTotal, id],
            );

            await client.query("COMMIT");
            return { ...updatedOrderRows[0], items };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async list(filters: ListOrderFilters, salonId: string): Promise<{ data: Order[]; total: number }> {
        const conditions: string[] = [`o.salon_id = $1`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.search) {
            conditions.push(`(o.order_number ILIKE $${idx} OR sup.name ILIKE $${idx})`);
            values.push(`%${filters.search}%`);
            idx++;
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM orders o LEFT JOIN suppliers sup ON sup.id = o.supplier_id ${where}`,
            values,
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT o.*, sup.name AS supplier_name,
                    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS item_count
               FROM orders o
               LEFT JOIN suppliers sup ON sup.id = o.supplier_id
               ${where}
              ORDER BY o.created_at DESC
              LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset],
        );

        return { data: rows, total };
    },

    async getById(id: string, salonId: string): Promise<Order | null> {
        const { rows: orderRows } = await pool.query(
            `SELECT o.*, sup.name AS supplier_name
               FROM orders o
               LEFT JOIN suppliers sup ON sup.id = o.supplier_id
              WHERE o.id = $1 AND o.salon_id = $2`,
            [id, salonId],
        );
        if (!orderRows.length) return null;

        const { rows: itemRows } = await pool.query(
            `SELECT oi.*, p.name AS product_name
               FROM order_items oi
               JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = $1
              ORDER BY oi.created_at ASC`,
            [id],
        );

        return { ...orderRows[0], items: itemRows };
    },

    async listSignatures(salonId: string): Promise<OrderSignature[]> {
        const { rows } = await pool.query(
            `SELECT * FROM order_signatures WHERE salon_id = $1 ORDER BY created_at DESC`,
            [salonId],
        );
        return rows;
    },

    async addSignature(salonId: string, url: string, createdBy: string): Promise<OrderSignature> {
        const { rows } = await pool.query(
            `INSERT INTO order_signatures (salon_id, url, created_by) VALUES ($1, $2, $3) RETURNING *`,
            [salonId, url, createdBy],
        );
        return rows[0];
    },

    // Orders are a document only (no stock/movement rows to unwind — see the
    // "no stock movement" note atop create()), so deleting one is a plain
    // row delete; order_items cascades via its FK to orders.
    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM orders WHERE id = $1 AND salon_id = $2`,
            [id, salonId],
        );
        return (rowCount ?? 0) > 0;
    },
};
