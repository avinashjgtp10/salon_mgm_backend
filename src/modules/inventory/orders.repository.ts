import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { CreateOrderDTO, ListOrderFilters, Order, OrderItem, OrderSignature, ReceiveOrderDTO } from "./orders.types";
import { purchasesRepository } from "./purchases.repository";

// Schema (orders, order_items, order_signatures, salons.next_order_seq) is
// NOT self-migrated from here — per project policy, schema changes are never
// auto-run. See Migration/create_orders_tables.sql; run it by hand against
// each environment before using this module.

export const ordersRepository = {
    /**
     * Records a purchase order document — header + line items, its own
     * sequential order number. Creating an Order itself never touches
     * products.amount or stock_movements: an Order precedes receiving, it
     * doesn't record a delivery — see receive() below for the step that does.
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
                           salon_id, order_number, status, supplier_id,
                           bill_to_branch_id, ship_to_branch_id, order_date,
                           remark, ref_number, payment_terms_days,
                           shipment_date, delivery_date,
                           tax_type, tax_group, terms_conditions, signature_url,
                           shipping_cost, created_by
                         ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                         RETURNING *`,
                        [
                            salonId, orderNumber, data.status === "draft" ? "draft" : "sent", data.supplier_id,
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
        if (filters.status) {
            conditions.push(`o.status = $${idx++}`);
            values.push(filters.status);
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

    /**
     * Records a delivery against this Order — the step the diagrammed flow
     * calls "Receive Against Order". Reuses purchasesRepository.create()
     * for the actual stock-in (products.amount + stock_movements + a
     * SUP-numbered Purchase row, order_id-linked) rather than duplicating
     * that transaction here, so this and a standalone Purchase always move
     * stock identically. Supports partial receiving: each call only sends
     * the quantities that arrived THIS delivery; order_items.received_qty
     * accumulates across calls, and the order's status is derived from it.
     */
    async receive(orderId: string, data: ReceiveOrderDTO, salonId: string, createdBy: string): Promise<Order> {
        const order = await this.getById(orderId, salonId);
        if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
        if (order.status === "cancelled") throw new AppError(400, "Cannot receive a cancelled order", "ORDER_CANCELLED");
        if (order.status === "received") throw new AppError(400, "Order is already fully received", "ORDER_ALREADY_RECEIVED");

        const itemsById = new Map((order.items ?? []).map((i) => [i.id, i]));
        const purchaseItems: { product_id: string; quantity: number; purchase_price: number }[] = [];

        for (const line of data.items) {
            const orderItem = itemsById.get(line.order_item_id);
            if (!orderItem) throw new AppError(400, `order_item_id ${line.order_item_id} does not belong to this order`, "VALIDATION_ERROR");
            const remaining = Number(orderItem.qty) - Number(orderItem.received_qty);
            if (line.received_qty > remaining + 0.001) {
                throw new AppError(400, `Cannot receive ${line.received_qty} of "${orderItem.product_name ?? orderItem.product_id}" — only ${remaining} remaining on this order`, "VALIDATION_ERROR");
            }
            if (line.received_qty > 0) {
                purchaseItems.push({ product_id: orderItem.product_id, quantity: line.received_qty, purchase_price: Number(orderItem.cost_price) });
            }
        }

        if (!purchaseItems.length) throw new AppError(400, "At least one item must have a received quantity > 0", "VALIDATION_ERROR");

        // The actual stock-in — same code path a standalone Purchase uses,
        // so products.amount/stock_movements/supplier balance all update
        // exactly the way they already do today.
        await purchasesRepository.create(
            { supplier_id: order.supplier_id, purchase_date: data.purchase_date, order_id: orderId, items: purchaseItems },
            salonId,
            createdBy,
        );

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const line of data.items) {
                if (line.received_qty <= 0) continue;
                await client.query(
                    `UPDATE order_items SET received_qty = received_qty + $1 WHERE id = $2`,
                    [line.received_qty, line.order_item_id],
                );
            }
            const { rows: refreshedItems } = await client.query(
                `SELECT qty, received_qty FROM order_items WHERE order_id = $1`,
                [orderId],
            );
            const fullyReceived = refreshedItems.every((r) => Number(r.received_qty) >= Number(r.qty) - 0.001);
            const anyReceived = refreshedItems.some((r) => Number(r.received_qty) > 0);
            const newStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : order.status;
            await client.query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, orderId]);
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        return (await this.getById(orderId, salonId))!;
    },

    /**
     * Corrects a mis-entered received_qty on one order line after the fact
     * (e.g. typed 10 when only 8 actually arrived). Does NOT touch the
     * Purchase/purchase_items rows already created by receive() — those stay
     * as the historical record of what was recorded on which date. Instead
     * this applies the delta directly to products.amount (so stock ends up
     * correct) and logs one 'adjustment' stock_movements row for the audit
     * trail, then re-derives the order's status the same way receive() does.
     */
    async correctReceivedQty(orderId: string, orderItemId: string, newReceivedQty: number, salonId: string, createdBy: string): Promise<Order> {
        const order = await this.getById(orderId, salonId);
        if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
        if (order.status === "cancelled") throw new AppError(400, "Cannot edit a cancelled order", "ORDER_CANCELLED");

        const orderItem = (order.items ?? []).find((i) => i.id === orderItemId);
        if (!orderItem) throw new AppError(404, "Order item not found on this order", "ORDER_ITEM_NOT_FOUND");
        if (newReceivedQty > Number(orderItem.qty) + 0.001) {
            throw new AppError(400, `received_qty cannot exceed the ordered quantity (${orderItem.qty})`, "VALIDATION_ERROR");
        }

        const delta = newReceivedQty - Number(orderItem.received_qty);
        if (Math.abs(delta) < 0.001) {
            return order;
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: prodRows } = await client.query(
                `SELECT id, COALESCE(amount, 0)::float8 AS amount, bottle_size
                   FROM products WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [orderItem.product_id, salonId],
            );
            if (!prodRows.length) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");

            const bottleSize = Number(prodRows[0].bottle_size) || 0;
            const baseUnitsPerPack = bottleSize > 0 ? bottleSize : 1;
            const beforeBase = Number(prodRows[0].amount) || 0;
            const deltaBase = delta * baseUnitsPerPack;
            const afterBase = beforeBase + deltaBase;
            if (afterBase < 0) {
                throw new AppError(400, "This correction would take stock below zero", "VALIDATION_ERROR");
            }

            await client.query(
                `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3`,
                [afterBase, orderItem.product_id, salonId],
            );

            await client.query(
                `INSERT INTO stock_movements
                   (product_id, movement_type, quantity, unit_price, total_amount,
                    supplier_id, notes, created_by, before_stock, after_stock)
                 VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    orderItem.product_id,
                    Math.abs(delta),
                    Number(orderItem.cost_price),
                    Math.abs(delta) * Number(orderItem.cost_price),
                    order.supplier_id,
                    `Correction of received qty on order ${order.order_number}`,
                    createdBy,
                    beforeBase / baseUnitsPerPack,
                    afterBase / baseUnitsPerPack,
                ],
            );

            await client.query(
                `UPDATE order_items SET received_qty = $1 WHERE id = $2`,
                [newReceivedQty, orderItemId],
            );

            const { rows: refreshedItems } = await client.query(
                `SELECT qty, received_qty FROM order_items WHERE order_id = $1`,
                [orderId],
            );
            const fullyReceived = refreshedItems.every((r) => Number(r.received_qty) >= Number(r.qty) - 0.001);
            const anyReceived = refreshedItems.some((r) => Number(r.received_qty) > 0);
            const newStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : "sent";
            await client.query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, orderId]);

            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        return (await this.getById(orderId, salonId))!;
    },

    async cancel(orderId: string, salonId: string): Promise<Order> {
        const order = await this.getById(orderId, salonId);
        if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
        if (order.status === "received" || order.status === "partially_received") {
            throw new AppError(400, "Cannot cancel an order that has already been received against", "ORDER_ALREADY_RECEIVED");
        }
        await pool.query(`UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND salon_id = $2`, [orderId, salonId]);
        return (await this.getById(orderId, salonId))!;
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
