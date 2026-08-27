import pool from "../../config/database";
import { productInventoryRepository, ProductInventoryRow } from "./product-inventory.repository";
import { CreatePurchaseDTO, ListPurchaseFilters, Purchase, PurchaseItem } from "./purchases.types";

// Schema (purchases, purchase_items, salons.next_purchase_seq) is NOT
// self-migrated from here — per project policy, schema changes are never
// auto-run. See Migration/create_purchases_tables.sql; run it by hand
// against each environment before using this module.

// Payouts are always general balance payments against a supplier (see
// supplier_payments — no per-order linkage), but the Orders tab still wants
// to show each order as paid/due/overdue. Allocate the supplier's total
// payments across their orders oldest-first (FIFO) purely for that display —
// this is a read-time projection, not a stored allocation, so it always
// reflects the current total regardless of which orders happen to be on the
// current page.
async function withPaymentStatus(rows: any[], supplierId: string, salonId: string): Promise<any[]> {
    const { rows: paidRows } = await pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float8 AS total_paid
           FROM supplier_payments
          WHERE supplier_id = $1 AND salon_id = $2`,
        [supplierId, salonId],
    );
    let remainingCredit = Number(paidRows[0].total_paid) || 0;

    const { rows: allOrders } = await pool.query(
        `SELECT id, total_amount, purchase_date FROM purchases
          WHERE supplier_id = $1 AND salon_id = $2
          ORDER BY purchase_date ASC, created_at ASC`,
        [supplierId, salonId],
    );

    const amountDueById = new Map<string, number>();
    for (const order of allOrders) {
        const total = Number(order.total_amount) || 0;
        const applied = Math.min(remainingCredit, total);
        remainingCredit -= applied;
        amountDueById.set(order.id, Math.max(0, total - applied));
    }

    const today = new Date().toISOString().slice(0, 10);
    return rows.map((row) => {
        const total = Number(row.total_amount) || 0;
        const due = amountDueById.get(row.id) ?? total;
        const paid = total - due;
        const purchaseDate = row.purchase_date instanceof Date
            ? row.purchase_date.toISOString().slice(0, 10)
            : String(row.purchase_date).slice(0, 10);
        const status = due <= 0 ? "paid" : purchaseDate < today ? "overdue" : "due";
        return { ...row, amount_paid: paid, amount_due: due, payment_status: status };
    });
}

export const purchasesRepository = {
    /**
     * Records a purchase from a supplier: one header row, one row per product
     * line, a stock_movements 'in' row per line (so PurchaseVsSalesReport and
     * the existing Stock History modal pick this up with zero changes to
     * either), and applies the added quantity straight to products.amount.
     *
     * Single transaction for the single POST this whole feature is built
     * around — no per-item round trips, no follow-up requests needed to see
     * the result (the caller gets the fully recomputed product rows back too,
     * see getById-shaped return value assembled by the controller).
     */
    async create(data: CreatePurchaseDTO, salonId: string, createdBy: string): Promise<{
        purchase: Purchase;
        updatedProducts: ProductInventoryRow[];
    }> {
        // Same product added twice on one purchase (defensive — the UI
        // shouldn't allow it, but a duplicate would otherwise take two
        // separate row locks on the same product and self-deadlock).
        const byProduct = new Map<string, { quantity: number; purchase_price: number; expiry_date: string | null }>();
        for (const item of data.items) {
            const existing = byProduct.get(item.product_id);
            if (existing) {
                existing.quantity += item.quantity;
                // Later line's price/expiry wins — same "last one typed wins"
                // posture as everywhere else duplicate input silently merges.
                existing.purchase_price = item.purchase_price;
                existing.expiry_date = item.expiry_date ?? existing.expiry_date;
            } else {
                byProduct.set(item.product_id, {
                    quantity: item.quantity,
                    purchase_price: item.purchase_price,
                    expiry_date: item.expiry_date ?? null,
                });
            }
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Per-salon sequential purchase numbers — identical retry pattern to
            // sales.repository.ts's invoice numbers (see next_invoice_seq).
            let purchase: any;
            for (let attempt = 0; ; attempt++) {
                const { rows: seqRows } = await client.query(
                    `UPDATE salons SET next_purchase_seq = next_purchase_seq + 1
                     WHERE id = $1 RETURNING next_purchase_seq - 1 AS seq`,
                    [salonId],
                );
                const seq = seqRows[0].seq;
                const purchaseNumber = `SUP-${String(seq).padStart(5, "0")}`;

                await client.query("SAVEPOINT purchase_insert_attempt");
                try {
                    const purchaseResult = await client.query(
                        `INSERT INTO purchases (salon_id, supplier_id, purchase_number, purchase_date, created_by)
                         VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5)
                         RETURNING *`,
                        [salonId, data.supplier_id, purchaseNumber, data.purchase_date ?? null, createdBy],
                    );
                    await client.query("RELEASE SAVEPOINT purchase_insert_attempt");
                    purchase = purchaseResult.rows[0];
                    break;
                } catch (insertErr: any) {
                    await client.query("ROLLBACK TO SAVEPOINT purchase_insert_attempt");
                    const isCollision = insertErr?.code === "23505"
                        && insertErr?.constraint === "purchases_salon_id_purchase_number_key";
                    if (!isCollision || attempt >= 5) throw insertErr;
                }
            }

            let totalAmount = 0;
            const items: PurchaseItem[] = [];

            for (const [productId, line] of byProduct) {
                const { rows: prodRows } = await client.query(
                    `SELECT id, COALESCE(amount, 0)::float8 AS amount, bottle_size
                       FROM products
                      WHERE id = $1 AND salon_id = $2
                      FOR UPDATE`,
                    [productId, salonId],
                );
                if (!prodRows.length) {
                    throw new Error(`Product not found in this salon: ${productId}`);
                }

                const bottleSize = Number(prodRows[0].bottle_size) || 0;
                const baseUnitsPerPack = bottleSize > 0 ? bottleSize : 1;
                const beforeBase = Number(prodRows[0].amount) || 0;
                const addedBase = line.quantity * baseUnitsPerPack;
                const afterBase = beforeBase + addedBase;

                await client.query(
                    `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3`,
                    [afterBase, productId, salonId],
                );

                const lineTotal = line.quantity * line.purchase_price;
                totalAmount += lineTotal;

                const { rows: mvRows } = await client.query(
                    `INSERT INTO stock_movements
                       (product_id, movement_type, quantity, unit_price, total_amount,
                        supplier_id, notes, created_by, before_stock, after_stock)
                     VALUES ($1, 'in', $2, $3, $4, $5, $6, $7, $8, $9)
                     RETURNING id`,
                    [
                        productId,
                        line.quantity,
                        line.purchase_price,
                        lineTotal,
                        data.supplier_id,
                        `Purchase ${purchase.purchase_number}`,
                        createdBy,
                        beforeBase / baseUnitsPerPack,
                        afterBase / baseUnitsPerPack,
                    ],
                );

                const { rows: itemRows } = await client.query(
                    `INSERT INTO purchase_items
                       (purchase_id, product_id, quantity, purchase_price, total_price, expiry_date, stock_movement_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING *`,
                    [purchase.id, productId, line.quantity, line.purchase_price, lineTotal, line.expiry_date, mvRows[0].id],
                );
                items.push(itemRows[0]);
            }

            const { rows: updatedPurchaseRows } = await client.query(
                `UPDATE purchases SET total_amount = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [totalAmount, purchase.id],
            );
            purchase = updatedPurchaseRows[0];

            await client.query("COMMIT");

            const updatedProducts = await productInventoryRepository.getRowsByProductIds(
                Array.from(byProduct.keys()),
                salonId,
            );

            return { purchase: { ...purchase, items }, updatedProducts };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async list(filters: ListPurchaseFilters, salonId: string): Promise<{ data: Purchase[]; total: number }> {
        const conditions: string[] = [`pu.salon_id = $1`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.search) {
            conditions.push(`(pu.purchase_number ILIKE $${idx} OR sup.name ILIKE $${idx})`);
            values.push(`%${filters.search}%`);
            idx++;
        }
        if (filters.supplier_id) {
            conditions.push(`pu.supplier_id = $${idx++}`);
            values.push(filters.supplier_id);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM purchases pu LEFT JOIN suppliers sup ON sup.id = pu.supplier_id ${where}`,
            values,
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT pu.*, sup.name AS supplier_name,
                    (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id)::int AS item_count
               FROM purchases pu
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
               ${where}
              ORDER BY pu.created_at DESC
              LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset],
        );

        // Only worth computing per-order payment status when scoped to one
        // supplier (the Supplier Detail Orders tab) — the plain Purchase
        // History list has no due/payment concept and doesn't need it.
        if (filters.supplier_id && rows.length) {
            return { data: await withPaymentStatus(rows, filters.supplier_id, salonId), total };
        }

        return { data: rows, total };
    },

    async getById(id: string, salonId: string): Promise<Purchase | null> {
        const { rows: purchaseRows } = await pool.query(
            `SELECT pu.*, sup.name AS supplier_name
               FROM purchases pu
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
              WHERE pu.id = $1 AND pu.salon_id = $2`,
            [id, salonId],
        );
        if (!purchaseRows.length) return null;

        const { rows: itemRows } = await pool.query(
            `SELECT pi.*, p.name AS product_name
               FROM purchase_items pi
               JOIN products p ON p.id = pi.product_id
              WHERE pi.purchase_id = $1
              ORDER BY pi.created_at ASC`,
            [id],
        );

        return { ...purchaseRows[0], items: itemRows };
    },
};
