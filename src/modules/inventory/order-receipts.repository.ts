import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { OrderReceipt, OrderReceiptWithItems, UpsertReceiptItemBody } from "./order-receipts.types";
import { purchasesRepository } from "./purchases.repository";
import { ordersRepository } from "./orders.repository";
import { Order } from "./orders.types";

// Schema (order_receipts, order_receipt_items, order_items.damaged_qty) is
// NOT self-migrated from here — per project policy, schema changes are never
// auto-run. See Migration/add_order_receiving_sessions.sql; run it by hand
// against each environment before using this module.

const RECEIPT_SELECT = `
  SELECT orc.*,
         b.name AS branch_name,
         NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS received_by_name
    FROM order_receipts orc
    LEFT JOIN branches b ON b.id = orc.branch_id
    LEFT JOIN users u ON u.id = orc.received_by`;

const ITEM_SELECT = `
  SELECT ori.*, p.name AS product_name
    FROM order_receipt_items ori
    JOIN products p ON p.id = ori.product_id
   WHERE ori.order_receipt_id = $1
   ORDER BY ori.created_at ASC`;

async function attachItems(receipt: OrderReceipt): Promise<OrderReceiptWithItems> {
    const { rows: items } = await pool.query(ITEM_SELECT, [receipt.id]);
    return { ...receipt, items };
}

export const orderReceiptsRepository = {
    async findDraft(orderId: string, salonId: string): Promise<OrderReceiptWithItems | null> {
        const { rows } = await pool.query(
            `${RECEIPT_SELECT} WHERE orc.order_id = $1 AND orc.salon_id = $2 AND orc.status = 'draft'
             ORDER BY orc.created_at DESC LIMIT 1`,
            [orderId, salonId],
        );
        if (!rows.length) return null;
        return attachItems(rows[0]);
    },

    async getById(id: string, salonId: string): Promise<OrderReceiptWithItems | null> {
        const { rows } = await pool.query(
            `${RECEIPT_SELECT} WHERE orc.id = $1 AND orc.salon_id = $2`,
            [id, salonId],
        );
        if (!rows.length) return null;
        return attachItems(rows[0]);
    },

    // Seeds one order_receipt_item per order_item, defaulted to the order
    // item's current cumulative confirmed/damaged totals — so opening a fresh
    // draft shows exactly what's already been received, and the clerk only
    // has to raise the numbers by however much just arrived.
    async createDraft(orderId: string, salonId: string, createdBy: string): Promise<OrderReceiptWithItems> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: orderItems } = await client.query(
                `SELECT id, product_id, received_qty, damaged_qty FROM order_items WHERE order_id = $1`,
                [orderId],
            );
            if (!orderItems.length) throw new AppError(404, "Order has no items", "ORDER_NOT_FOUND");

            const { rows: receiptRows } = await client.query(
                `INSERT INTO order_receipts (salon_id, order_id, created_by)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [salonId, orderId, createdBy],
            );
            const receipt = receiptRows[0];

            for (const oi of orderItems) {
                await client.query(
                    `INSERT INTO order_receipt_items (order_receipt_id, order_item_id, product_id, confirmed_qty, damaged_qty)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [receipt.id, oi.id, oi.product_id, oi.received_qty, oi.damaged_qty],
                );
            }

            await client.query("COMMIT");
            return (await this.getById(receipt.id, salonId))!;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async getOrCreateDraft(orderId: string, salonId: string, createdBy: string): Promise<OrderReceiptWithItems> {
        const existing = await this.findDraft(orderId, salonId);
        if (existing) return existing;
        return this.createDraft(orderId, salonId, createdBy);
    },

    async updateHeader(id: string, salonId: string, patch: { branch_id?: string | null; received_by?: string | null }): Promise<void> {
        await pool.query(
            `UPDATE order_receipts
                SET branch_id = COALESCE($1, branch_id),
                    received_by = COALESCE($2, received_by),
                    updated_at = NOW()
              WHERE id = $3 AND salon_id = $4 AND status = 'draft'`,
            [patch.branch_id ?? null, patch.received_by ?? null, id, salonId],
        );
    },

    // Save Draft — pure write to order_receipt_items, no stock/ledger effect.
    async upsertItems(id: string, items: UpsertReceiptItemBody[]): Promise<void> {
        if (!items.length) return;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const it of items) {
                await client.query(
                    `UPDATE order_receipt_items
                        SET confirmed_qty = $1, damaged_qty = $2, updated_at = NOW()
                      WHERE order_receipt_id = $3 AND order_item_id = $4`,
                    [it.confirmed_qty, it.damaged_qty, id, it.order_item_id],
                );
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Confirm Receiving — the one moment stock actually moves. Mirrors
     * ordersRepository.receive()'s two-phase shape: purchasesRepository
     * .create() is called first (its own transaction, same as receive()
     * already does) for the confirmed-quantity delta only, using this
     * receipt's chosen branch_id instead of the auto-resolved main branch;
     * then a second transaction locks the receipt, sets order_items'
     * received_qty/damaged_qty to the receipt's absolute targets, recomputes
     * order.status, and flips the receipt to 'confirmed'.
     *
     * confirmed_qty/damaged_qty are absolute cumulative targets (not deltas)
     * — same "absolute, not delta" safety principle as
     * product-audit.repository.ts#approveWithAdjustments, so a draft that
     * went stale relative to a concurrent correction still lands on the
     * right number rather than double-applying.
     */
    async confirmReceipt(
        receiptId: string, salonId: string, confirmedBy: string, purchaseDate?: string,
    ): Promise<{ order: Order; receipt: OrderReceipt }> {
        const receipt = await this.getById(receiptId, salonId);
        if (!receipt) throw new AppError(404, "Receipt not found", "RECEIPT_NOT_FOUND");
        if (receipt.status !== "draft") throw new AppError(409, "This receipt has already been confirmed", "RECEIPT_ALREADY_CONFIRMED");
        if (!receipt.branch_id) throw new AppError(400, "Select a Receiving Location before confirming", "VALIDATION_ERROR");
        if (!receipt.received_by) throw new AppError(400, "Select Received By before confirming", "VALIDATION_ERROR");

        const order = await ordersRepository.getById(receipt.order_id, salonId);
        if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");

        const orderItemsById = new Map((order.items ?? []).map((i) => [i.id, i]));
        const purchaseItems: { product_id: string; quantity: number; purchase_price: number }[] = [];

        for (const ri of receipt.items) {
            const orderItem = orderItemsById.get(ri.order_item_id);
            if (!orderItem) continue;
            if (ri.confirmed_qty + ri.damaged_qty > Number(orderItem.qty) + 0.001) {
                throw new AppError(
                    400,
                    `Confirmed + Damaged (${ri.confirmed_qty + ri.damaged_qty}) exceeds Ordered (${orderItem.qty}) for "${orderItem.product_name ?? orderItem.product_id}"`,
                    "VALIDATION_ERROR",
                );
            }
            const delta = ri.confirmed_qty - Number(orderItem.received_qty);
            if (delta > 0) {
                purchaseItems.push({ product_id: orderItem.product_id, quantity: delta, purchase_price: Number(orderItem.cost_price) });
            }
        }

        if (purchaseItems.length) {
            await purchasesRepository.create(
                {
                    supplier_id: order.supplier_id, purchase_date: purchaseDate, order_id: order.id,
                    branch_id: receipt.branch_id, items: purchaseItems,
                },
                salonId,
                confirmedBy,
            );
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Re-locks and re-checks status so two concurrent Confirm clicks
            // can't both pass and double-apply — same guard as
            // product-audit.repository.ts#approveWithAdjustments.
            const { rows: lockedRows } = await client.query(
                `SELECT * FROM order_receipts WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                [receiptId, salonId],
            );
            const locked = lockedRows[0];
            if (!locked) throw new AppError(404, "Receipt not found", "RECEIPT_NOT_FOUND");
            if (locked.status !== "draft") throw new AppError(409, "This receipt has already been confirmed", "RECEIPT_ALREADY_CONFIRMED");

            for (const ri of receipt.items) {
                await client.query(
                    `UPDATE order_items SET received_qty = $1, damaged_qty = $2 WHERE id = $3`,
                    [ri.confirmed_qty, ri.damaged_qty, ri.order_item_id],
                );
            }

            const { rows: refreshedItems } = await client.query(
                `SELECT qty, received_qty, damaged_qty FROM order_items WHERE order_id = $1`,
                [order.id],
            );
            const fullyAccounted = refreshedItems.every(
                (r) => Number(r.received_qty) + Number(r.damaged_qty) >= Number(r.qty) - 0.001,
            );
            const anyProgress = refreshedItems.some((r) => Number(r.received_qty) + Number(r.damaged_qty) > 0);
            const newStatus = fullyAccounted ? "received" : anyProgress ? "partially_received" : order.status;
            await client.query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, order.id]);

            const { rows: confirmedRows } = await client.query(
                `UPDATE order_receipts SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
                  WHERE id = $1 RETURNING *`,
                [receiptId],
            );

            await client.query("COMMIT");

            const updatedOrder = (await ordersRepository.getById(order.id, salonId))!;
            return { order: updatedOrder, receipt: confirmedRows[0] };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
