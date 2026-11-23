import pool from "../../config/database";
import { productInventoryRepository, ProductInventoryRow } from "./product-inventory.repository";
import { CreatePurchaseDTO, CreateHistoricalPurchaseDTO, ListPurchaseFilters, Purchase, PurchaseItem, PurchaseChartFilters } from "./purchases.types";
import { inventoryAlertsService } from "./inventory-alerts.service";
import { AppError } from "../../middleware/error.middleware";

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

// What makes a bill "historical" (safe to edit / delete because it never changed stock)? Decided from the data itself, not from one flag:
//   1. stock_applied = FALSE  -> recorded with "Add Past Bill".
//   2. OR it has NO purchase order, HAS product lines, and NONE of those lines created a stock movement -> a bill imported by an earlier data
//      migration (those rows kept the column default stock_applied = TRUE even though no stock was ever moved for them).
// A purchase-order receipt (order_id set) or any bill whose lines moved stock is never historical, so it can't be edited or deleted here.
// `alias` is the purchases table alias in the surrounding query.
const historicalBillSql = (alias: string) => `(
    ${alias}.stock_applied = FALSE
    OR (
        ${alias}.order_id IS NULL
        AND EXISTS (SELECT 1 FROM purchase_items h WHERE h.purchase_id = ${alias}.id)
        AND NOT EXISTS (SELECT 1 FROM purchase_items h WHERE h.purchase_id = ${alias}.id AND h.stock_movement_id IS NOT NULL)
    )
)`;

// Payouts are not tied to individual bills, so the only "transaction link" a past bill has is the supplier's running balance. Refuse any
// edit / delete that would leave the supplier's bills worth LESS than what has already been paid to them (a negative balance).
async function assertStillCoversPayments(
    q: { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> },
    supplierId: string,
    salonId: string,
    purchaseId: string,
    newBillTotal: number,
    oldBillTotal: number,
): Promise<void> {
    if (newBillTotal >= oldBillTotal) return;   // not reducing what is owed, so nothing to protect
    const { rows } = await q.query(
        `SELECT
            (SELECT COALESCE(SUM(total_amount), 0)::float8 FROM purchases WHERE supplier_id = $1 AND salon_id = $2 AND id <> $3) AS others,
            (SELECT COALESCE(SUM(amount), 0)::float8 FROM supplier_payments WHERE supplier_id = $1 AND salon_id = $2) AS paid`,
        [supplierId, salonId, purchaseId],
    );
    const others = Number(rows[0].others) || 0;
    const paid = Number(rows[0].paid) || 0;
    if (others + newBillTotal < paid - 0.005) {
        throw new AppError(
            409,
            `Cannot reduce or delete this bill: ${paid.toFixed(2)} has already been paid to this supplier, which is more than the remaining bills (${(others + newBillTotal).toFixed(2)}) would cover. Remove or adjust the payout first.`,
            "BILL_LINKED_TO_PAYMENTS",
        );
    }
}

type Tx = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * EDIT a bill that already moved stock (a PO receipt or a direct purchase). Only what can change WITHOUT touching stock is allowed: bill date,
 * bill number, notes and each line's price + tax. Products and quantities must match what was received, because changing them would mean moving
 * stock (do that by deleting the bill, which reverses the stock, and receiving again). Lines are matched by their own id, so nothing is re-created.
 * The money columns on the linked stock_movements / stock_ledger rows are kept in step so reports never disagree with the bill.
 */
async function updateStockedBill(
    tx: Tx,
    bill: { id: string; supplier_id: string; total_amount: number; purchase_number: string },
    data: Omit<CreateHistoricalPurchaseDTO, "supplier_id">,
    salonId: string,
): Promise<{ purchase: Purchase }> {
    const LOCKED = "This bill already added stock, so its products and quantities cannot be changed here. You can edit the bill date, bill number, notes, prices and tax. To change quantities, delete the bill (stock is reversed) and receive it again.";
    const { rows: lines } = await tx.query(
        `SELECT id, product_id, quantity::float8 AS quantity, stock_movement_id FROM purchase_items WHERE purchase_id = $1`,
        [bill.id],
    );
    if (data.items.length !== lines.length) throw new AppError(409, LOCKED, "BILL_STOCK_LOCKED");
    const byId = new Map(lines.map((l: any) => [l.id, l]));
    const seen = new Set<string>();
    for (const it of data.items) {
        const line: any = it.id ? byId.get(it.id) : undefined;
        if (!line || seen.has(line.id) || line.product_id !== it.product_id || Math.abs(line.quantity - it.quantity) > 0.0005) {
            throw new AppError(409, LOCKED, "BILL_STOCK_LOCKED");
        }
        seen.add(line.id);
    }

    const newTotal = money(data.items.reduce((s, l) => s + money(l.quantity * l.purchase_price * (1 + (l.tax_percent ?? 0) / 100)), 0));
    await assertStillCoversPayments(tx, bill.supplier_id, salonId, bill.id, newTotal, Number(bill.total_amount) || 0);

    const perProduct = new Map<string, number>();
    for (const l of lines) perProduct.set(l.product_id, (perProduct.get(l.product_id) ?? 0) + 1);

    const items: PurchaseItem[] = [];
    for (const it of data.items) {
        const line: any = byId.get(it.id as string);
        const tax = it.tax_percent ?? 0;
        const lineTotal = money(it.quantity * it.purchase_price * (1 + tax / 100));
        const { rows } = await tx.query(
            `UPDATE purchase_items SET purchase_price = $1, tax_percent = $2, total_price = $3 WHERE id = $4 RETURNING *`,
            [it.purchase_price, tax, lineTotal, line.id],
        );
        items.push(rows[0]);
        if (line.stock_movement_id) {
            await tx.query(
                `UPDATE stock_movements SET unit_price = $1, total_amount = $2 WHERE id = $3`,
                [it.purchase_price, money(it.quantity * it.purchase_price), line.stock_movement_id],
            );
        }
        // The ledger row has no link to the line, so match it by bill + product; skipped when one bill carries the product twice (ambiguous).
        if (perProduct.get(line.product_id) === 1) {
            await tx.query(
                `UPDATE stock_ledger SET unit_cost = $1, updated_at = NOW()
                  WHERE salon_id = $2 AND reference = $3 AND product_id = $4 AND transaction_type = 'purchase'`,
                [it.purchase_price, salonId, bill.purchase_number, line.product_id],
            );
        }
    }

    const { rows: updated } = await tx.query(
        `UPDATE purchases SET purchase_date = $1, bill_number = $2, notes = $3, total_amount = $4, updated_at = NOW()
          WHERE id = $5 AND salon_id = $6 RETURNING *`,
        [data.purchase_date, data.bill_number ?? null, data.notes ?? null, newTotal, bill.id, salonId],
    );
    return { purchase: { ...updated[0], items } };
}

/**
 * DELETE a bill that already moved stock, by REVERSING it, all in the caller's transaction:
 *  - products.amount goes back down by what the bill added (refused, with the numbers, if that stock has already been used or sold);
 *  - a stock_ledger 'adjustment_out' row is written per line, so the ledger shows the purchase AND its reversal (nothing is rewritten);
 *  - the 'in' stock_movements rows of the bill are removed, so Stock History / Purchase reports stop counting it;
 *  - for a purchase-order receipt, the quantities it recorded on the order are given back (back to pending) and the order status is recomputed;
 *  - then the bill and its lines are deleted. Supplier totals / balances are computed live from purchases, so they follow automatically.
 */
async function deleteStockedBill(
    tx: Tx,
    bill: { id: string; supplier_id: string; total_amount: number; purchase_number: string; order_id: string | null },
    salonId: string,
    userId: string | null,
): Promise<void> {
    await assertStillCoversPayments(tx, bill.supplier_id, salonId, bill.id, 0, Number(bill.total_amount) || 0);

    const { rows: lines } = await tx.query(
        `SELECT id, product_id, quantity::float8 AS quantity, purchase_price::float8 AS purchase_price, stock_movement_id
           FROM purchase_items WHERE purchase_id = $1 ORDER BY created_at ASC`,
        [bill.id],
    );

    // Lock every product once, in a fixed order (same rule as create(): no deadlocks between two concurrent bills).
    const productIds = Array.from(new Set(lines.map((l: any) => l.product_id as string))).sort();
    const running = new Map<string, { amount: number; perPack: number; name: string }>();
    for (const pid of productIds) {
        const { rows } = await tx.query(
            `SELECT COALESCE(amount, 0)::float8 AS amount, bottle_size, name FROM products WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
            [pid, salonId],
        );
        if (!rows.length) continue;   // product since removed: nothing to take back
        const bottle = Number(rows[0].bottle_size) || 0;
        running.set(pid, { amount: Number(rows[0].amount) || 0, perPack: bottle > 0 ? bottle : 1, name: rows[0].name });
    }

    // Refuse BEFORE changing anything if the stock this bill added is no longer on the shelf.
    const needed = new Map<string, number>();
    for (const l of lines) {
        const r = running.get(l.product_id);
        if (r) needed.set(l.product_id, (needed.get(l.product_id) ?? 0) + l.quantity * r.perPack);
    }
    for (const [pid, base] of needed) {
        const r = running.get(pid)!;
        if (r.amount + 0.0005 < base) {
            throw new AppError(
                409,
                `Cannot delete this bill: "${r.name}" has only ${r.amount / r.perPack} in stock, but this bill added ${base / r.perPack} and it has already been used or sold. Adjust the stock first or edit the bill instead.`,
                "INSUFFICIENT_STOCK_TO_REVERSE",
            );
        }
    }

    // The branch the original receipt was booked to (stock_ledger.branch_id is NOT NULL).
    const { rows: branchRows } = await tx.query(
        `SELECT branch_id FROM stock_ledger WHERE salon_id = $1 AND reference = $2 AND transaction_type = 'purchase' LIMIT 1`,
        [salonId, bill.purchase_number],
    );
    const branchId: string | null = branchRows[0]?.branch_id ?? null;

    for (const l of lines) {
        const r = running.get(l.product_id);
        if (!r) continue;
        const baseQty = l.quantity * r.perPack;
        r.amount = Math.max(0, r.amount - baseQty);
        await tx.query(`UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3`, [r.amount, l.product_id, salonId]);
        if (branchId) {
            await tx.query(
                `INSERT INTO stock_ledger (salon_id, branch_id, product_id, transaction_type, reference, quantity, unit_cost, balance_after, supplier_id, reason, created_by)
                 VALUES ($1, $2, $3, 'adjustment_out', $4, $5, $6, $7, $8, $9, $10)`,
                [salonId, branchId, l.product_id, `Reversal of ${bill.purchase_number}`, -baseQty, l.purchase_price, r.amount, bill.supplier_id,
                 "Supplier bill deleted: stock reversed", userId],
            );
        }
    }

    // Purchase order: hand the quantities back so the order shows them as pending again.
    if (bill.order_id) {
        await tx.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [bill.order_id]);
        const { rows: logs } = await tx.query(`SELECT id FROM order_receiving_log WHERE purchase_id = $1`, [bill.id]);
        if (logs.length) {
            const logIds = logs.map((x: any) => x.id);
            const { rows: logItems } = await tx.query(
                `SELECT order_item_id, received_qty::float8 AS received_qty, damaged_qty::float8 AS damaged_qty, rejected_qty::float8 AS rejected_qty
                   FROM order_receiving_log_items WHERE log_id = ANY($1::uuid[]) AND order_item_id IS NOT NULL`,
                [logIds],
            );
            for (const li of logItems) {
                await tx.query(
                    `UPDATE order_items SET received_qty = GREATEST(0, received_qty - $1), damaged_qty = GREATEST(0, damaged_qty - $2),
                            rejected_qty = GREATEST(0, rejected_qty - $3) WHERE id = $4`,
                    [li.received_qty, li.damaged_qty, li.rejected_qty, li.order_item_id],
                );
            }
            await tx.query(`DELETE FROM order_receiving_log WHERE id = ANY($1::uuid[])`, [logIds]);
        } else {
            // Older receipts without a delivery log: give back each line's quantity on the matching order line.
            for (const l of lines) {
                await tx.query(
                    `UPDATE order_items SET received_qty = GREATEST(0, received_qty - $1)
                      WHERE id = (SELECT id FROM order_items WHERE order_id = $2 AND product_id = $3 ORDER BY created_at ASC LIMIT 1)`,
                    [l.quantity, bill.order_id, l.product_id],
                );
            }
        }
        const { rows: ord } = await tx.query(`SELECT status FROM orders WHERE id = $1`, [bill.order_id]);
        if (ord[0] && ord[0].status !== "cancelled") {
            const { rows: oi } = await tx.query(`SELECT qty, received_qty, damaged_qty, rejected_qty FROM order_items WHERE order_id = $1`, [bill.order_id]);
            const accounted = (r: any) => Number(r.received_qty) + Number(r.damaged_qty) + Number(r.rejected_qty);
            const full = oi.length > 0 && oi.every((r: any) => accounted(r) >= Number(r.qty) - 0.001);
            const any = oi.some((r: any) => accounted(r) > 0);
            await tx.query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [full ? "received" : any ? "partially_received" : "sent", bill.order_id]);
        }
    }

    // Bill first (its lines go with it), then the movements those lines pointed at.
    await tx.query(`DELETE FROM purchases WHERE id = $1 AND salon_id = $2`, [bill.id, salonId]);
    const movementIds = lines.map((l: any) => l.stock_movement_id).filter(Boolean);
    if (movementIds.length) await tx.query(`DELETE FROM stock_movements WHERE id = ANY($1::uuid[])`, [movementIds]);
}

export const purchasesRepository = {
    /**
     * Records a purchase from a supplier: one header row, one row per product
     * line, a stock_movements 'in' row per line (so PurchaseVsSalesReport and
     * the existing Stock History modal pick this up with zero changes to
     * either), a matching stock_ledger 'purchase' row per line (so the Stock
     * Ledger page and Stock Movement Report's "Added (In)" figure also
     * reflect Receive Stock/Receive Against Order — previously only
     * stock_movements got written here, so those two ledger-backed views
     * never saw a Receive Stock purchase at all), and applies the added
     * quantity straight to products.amount.
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
        // The same product can appear on more than one line (different batch/
        // expiry/price per delivery) — each line stays its own purchase_items
        // + stock_movements row so that history isn't lost. Only the row LOCK
        // is deduplicated per product (sorted, so two concurrent purchases
        // touching the same products always lock in the same order and can't
        // deadlock each other) — quantities from every line for that product
        // are then applied to products.amount in sequence.
        const productIds = Array.from(new Set(data.items.map((i) => i.product_id))).sort();

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Purchases (and the products they add stock to) aren't scoped to
            // a branch, but stock_ledger.branch_id is NOT NULL — use the
            // caller's explicit branch_id when given (Confirm Receiving picks
            // one), else fall back to resolving the salon's main branch (or
            // any branch), the same way the ledger's own manual "Add Stock"
            // flow requires a branch to be picked.
            // The receiver must be one of THIS salon's staff — never trust an id
            // from the request body to point at another salon's staff row.
            if (data.received_by_staff_id) {
                const { rows: receiverRows } = await client.query(
                    `SELECT 1 FROM staff WHERE id = $1 AND salon_id = $2`,
                    [data.received_by_staff_id, salonId],
                );
                if (!receiverRows.length) {
                    throw new AppError(400, "received_by_staff_id is not a staff member of this salon", "VALIDATION_ERROR");
                }
            }

            let branchId: string | null = data.branch_id ?? null;
            if (!branchId) {
                const { rows: branchRows } = await client.query(
                    `SELECT id FROM branches WHERE salon_id = $1 ORDER BY is_main DESC, created_at ASC LIMIT 1`,
                    [salonId],
                );
                branchId = branchRows[0]?.id ?? null;
            }

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
                        `INSERT INTO purchases (salon_id, supplier_id, purchase_number, purchase_date, created_by, order_id, received_by_staff_id)
                         VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7)
                         RETURNING *`,
                        [salonId, data.supplier_id, purchaseNumber, data.purchase_date ?? null, createdBy, data.order_id ?? null, data.received_by_staff_id ?? null],
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

            // before/afterBase tracks each product's running stock (in base
            // units) across however many lines it appears on in this purchase,
            // so a second line for the same product continues from the first
            // line's result instead of overwriting it.
            const runningBase = new Map<string, { amount: number; baseUnitsPerPack: number }>();

            for (const productId of productIds) {
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
                runningBase.set(productId, {
                    amount: Number(prodRows[0].amount) || 0,
                    baseUnitsPerPack: bottleSize > 0 ? bottleSize : 1,
                });
            }

            for (const line of data.items) {
                const running = runningBase.get(line.product_id)!;
                const beforeBase = running.amount;
                const addedBase = line.quantity * running.baseUnitsPerPack;
                const afterBase = beforeBase + addedBase;
                running.amount = afterBase;

                await client.query(
                    `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3`,
                    [afterBase, line.product_id, salonId],
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
                        line.product_id,
                        line.quantity,
                        line.purchase_price,
                        lineTotal,
                        data.supplier_id,
                        `Purchase ${purchase.purchase_number}`,
                        createdBy,
                        beforeBase / running.baseUnitsPerPack,
                        afterBase / running.baseUnitsPerPack,
                    ],
                );

                // Mirrors the stock_movements row above into stock_ledger (base
                // units, same as balance_after everywhere else in that table)
                // so Receive Stock/Receive Against Order show up in the Stock
                // Ledger page and Stock Movement Report exactly like every
                // other "purchase" transaction_type entry does.
                if (branchId) {
                    await client.query(
                        `INSERT INTO stock_ledger (
                            salon_id, branch_id, product_id, transaction_type,
                            reference, quantity, unit_cost, balance_after, supplier_id, created_by
                         ) VALUES ($1,$2,$3,'purchase',$4,$5,$6,$7,$8,$9)`,
                        [
                            salonId, branchId, line.product_id,
                            purchase.purchase_number, addedBase, line.purchase_price,
                            afterBase, data.supplier_id, createdBy,
                        ],
                    );
                }

                const { rows: itemRows } = await client.query(
                    `INSERT INTO purchase_items
                       (purchase_id, product_id, quantity, purchase_price, total_price, expiry_date, stock_movement_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     RETURNING *`,
                    [purchase.id, line.product_id, line.quantity, line.purchase_price, lineTotal, line.expiry_date ?? null, mvRows[0].id],
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
                productIds,
                salonId,
            );

            inventoryAlertsService
                .checkAndNotify(productIds, salonId)
                .catch(() => { /* logged internally, never blocks the caller */ });
            return { purchase: { ...purchase, items }, updatedProducts };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Records an OLD supplier bill for the books only. Same purchases + purchase_items rows as create(), so the bill shows in the
     * supplier's Orders tab, totals, due amount and reports, but it NEVER touches products.amount, stock_movements or stock_ledger
     * (stock_applied = FALSE, purchase_items.stock_movement_id stays NULL). Still one transaction.
     */
    async createHistorical(data: CreateHistoricalPurchaseDTO, salonId: string, createdBy: string): Promise<{ purchase: Purchase }> {
        const productIds = Array.from(new Set(data.items.map((i) => i.product_id)));

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Never trust ids from the request body: the supplier and every product must belong to THIS salon.
            const { rows: supplierRows } = await client.query(`SELECT 1 FROM suppliers WHERE id = $1 AND salon_id = $2`, [data.supplier_id, salonId]);
            if (!supplierRows.length) throw new AppError(404, "Supplier not found", "SUPPLIER_NOT_FOUND");

            const { rows: productRows } = await client.query(
                `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND salon_id = $2`,
                [productIds, salonId],
            );
            if (productRows.length !== productIds.length) {
                throw new AppError(404, "One or more products were not found in this salon", "PRODUCT_NOT_FOUND");
            }

            // Same per-salon sequential number + retry-on-collision pattern as create().
            let purchase: any;
            for (let attempt = 0; ; attempt++) {
                const { rows: seqRows } = await client.query(
                    `UPDATE salons SET next_purchase_seq = next_purchase_seq + 1 WHERE id = $1 RETURNING next_purchase_seq - 1 AS seq`,
                    [salonId],
                );
                const purchaseNumber = `SUP-${String(seqRows[0].seq).padStart(5, "0")}`;

                await client.query("SAVEPOINT historical_insert_attempt");
                try {
                    const result = await client.query(
                        `INSERT INTO purchases (salon_id, supplier_id, purchase_number, purchase_date, created_by, stock_applied, bill_number, notes)
                         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
                         RETURNING *`,
                        [salonId, data.supplier_id, purchaseNumber, data.purchase_date, createdBy, data.bill_number ?? null, data.notes ?? null],
                    );
                    await client.query("RELEASE SAVEPOINT historical_insert_attempt");
                    purchase = result.rows[0];
                    break;
                } catch (insertErr: any) {
                    await client.query("ROLLBACK TO SAVEPOINT historical_insert_attempt");
                    const isCollision = insertErr?.code === "23505" && insertErr?.constraint === "purchases_salon_id_purchase_number_key";
                    if (!isCollision || attempt >= 5) throw insertErr;
                }
            }

            let totalAmount = 0;
            const items: PurchaseItem[] = [];
            for (const line of data.items) {
                // The line total INCLUDES its tax: qty x price x (1 + tax% / 100), to the cent.
                const taxPercent = line.tax_percent ?? 0;
                const lineTotal = Math.round(line.quantity * line.purchase_price * (1 + taxPercent / 100) * 100) / 100;
                totalAmount += lineTotal;
                const { rows: itemRows } = await client.query(
                    `INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price, tax_percent, total_price, expiry_date, stock_movement_id)
                     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
                     RETURNING *`,
                    [purchase.id, line.product_id, line.quantity, line.purchase_price, taxPercent, lineTotal],
                );
                items.push(itemRows[0]);
            }

            const { rows: updated } = await client.query(
                `UPDATE purchases SET total_amount = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [totalAmount, purchase.id],
            );

            await client.query("COMMIT");
            return { purchase: { ...updated[0], items } };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Edits a PAST bill (stock_applied = FALSE) only: date, bill number, notes and the product lines (replaced as a whole). The
     * supplier cannot be changed (delete and re-add instead). A normal purchase or order receipt is never editable here, because it
     * already moved stock; the WHERE ... stock_applied = FALSE guard is what keeps this endpoint from ever touching those.
     */
    async updateHistorical(id: string, data: Omit<CreateHistoricalPurchaseDTO, "supplier_id">, salonId: string): Promise<{ purchase: Purchase }> {
        const productIds = Array.from(new Set(data.items.map((i) => i.product_id)));
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: found } = await client.query(
                `SELECT ${historicalBillSql("pu")} AS is_historical, pu.supplier_id, pu.total_amount, pu.purchase_number
                   FROM purchases pu WHERE pu.id = $1 AND pu.salon_id = $2 FOR UPDATE OF pu`,
                [id, salonId],
            );
            if (!found.length) throw new AppError(404, "Bill not found", "PURCHASE_NOT_FOUND");
            if (found[0].is_historical !== true) {
                // A bill that already moved stock (PO receipt / direct purchase): prices, tax, date, number and notes only; stock stays as is.
                const result = await updateStockedBill(
                    client,
                    { id, supplier_id: found[0].supplier_id, total_amount: Number(found[0].total_amount) || 0, purchase_number: found[0].purchase_number },
                    data, salonId,
                );
                await client.query("COMMIT");
                return result;
            }
            const newTotal = data.items.reduce(
                (s, l) => s + Math.round(l.quantity * l.purchase_price * (1 + (l.tax_percent ?? 0) / 100) * 100) / 100, 0);
            await assertStillCoversPayments(client, found[0].supplier_id, salonId, id, newTotal, Number(found[0].total_amount) || 0);

            const { rows: productRows } = await client.query(
                `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND salon_id = $2`,
                [productIds, salonId],
            );
            if (productRows.length !== productIds.length) {
                throw new AppError(404, "One or more products were not found in this salon", "PRODUCT_NOT_FOUND");
            }

            await client.query(`DELETE FROM purchase_items WHERE purchase_id = $1`, [id]);

            let totalAmount = 0;
            const items: PurchaseItem[] = [];
            for (const line of data.items) {
                // The line total INCLUDES its tax: qty x price x (1 + tax% / 100), to the cent.
                const taxPercent = line.tax_percent ?? 0;
                const lineTotal = Math.round(line.quantity * line.purchase_price * (1 + taxPercent / 100) * 100) / 100;
                totalAmount += lineTotal;
                const { rows: itemRows } = await client.query(
                    `INSERT INTO purchase_items (purchase_id, product_id, quantity, purchase_price, tax_percent, total_price, expiry_date, stock_movement_id)
                     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)
                     RETURNING *`,
                    [id, line.product_id, line.quantity, line.purchase_price, taxPercent, lineTotal],
                );
                items.push(itemRows[0]);
            }

            const { rows: updated } = await client.query(
                `UPDATE purchases
                    SET purchase_date = $1, bill_number = $2, notes = $3, total_amount = $4, updated_at = NOW()
                  WHERE id = $5 AND salon_id = $6
              RETURNING *`,
                [data.purchase_date, data.bill_number ?? null, data.notes ?? null, totalAmount, id, salonId],
            );

            await client.query("COMMIT");
            return { purchase: { ...updated[0], items } };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /** Deletes a PAST bill (stock_applied = FALSE) and its lines (ON DELETE CASCADE). Stock is untouched, because the bill never changed it. */
    async deleteHistorical(id: string, salonId: string, userId: string | null = null): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const { rows: found } = await client.query(
                `SELECT ${historicalBillSql("pu")} AS is_historical, pu.supplier_id, pu.total_amount, pu.purchase_number, pu.order_id
                   FROM purchases pu WHERE pu.id = $1 AND pu.salon_id = $2 FOR UPDATE OF pu`, [id, salonId]);
            if (!found.length) throw new AppError(404, "Bill not found", "PURCHASE_NOT_FOUND");
            if (found[0].is_historical !== true) {
                // A bill that already moved stock: reverse the stock (and the purchase-order receipt) instead of just removing the row.
                await deleteStockedBill(
                    client,
                    { id, supplier_id: found[0].supplier_id, total_amount: Number(found[0].total_amount) || 0, purchase_number: found[0].purchase_number, order_id: found[0].order_id ?? null },
                    salonId, userId,
                );
                await client.query("COMMIT");
                return;
            }
            await assertStillCoversPayments(client, found[0].supplier_id, salonId, id, 0, Number(found[0].total_amount) || 0);
            // The guard is repeated in the DELETE itself so a row can never be removed unless it is still historical.
            await client.query(`DELETE FROM purchases pu WHERE pu.id = $1 AND pu.salon_id = $2 AND ${historicalBillSql("pu")}`, [id, salonId]);
            await client.query("COMMIT");
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
        if (filters.product_id) {
            conditions.push(`EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = pu.id AND pi.product_id = $${idx++})`);
            values.push(filters.product_id);
        }
        if (filters.date_from) {
            conditions.push(`pu.purchase_date >= $${idx++}`);
            values.push(filters.date_from);
        }
        if (filters.date_to) {
            conditions.push(`pu.purchase_date <= $${idx++}`);
            values.push(filters.date_to);
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
            `SELECT pu.*, sup.name AS supplier_name, po.order_number AS po_number,
                    ${historicalBillSql("pu")} AS is_historical,
                    NULLIF(TRIM(CONCAT(rb.first_name, ' ', COALESCE(rb.last_name, ''))), '') AS received_by_name,
                    (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id)::int AS item_count,
                    (SELECT COALESCE(SUM(pi.quantity), 0) FROM purchase_items pi WHERE pi.purchase_id = pu.id)::float8 AS total_quantity,
                    (SELECT COALESCE(SUM(pi.quantity * pi.purchase_price), 0) FROM purchase_items pi WHERE pi.purchase_id = pu.id)::float8 AS subtotal_amount,
                    (SELECT COALESCE(SUM(pi.total_price - pi.quantity * pi.purchase_price), 0) FROM purchase_items pi WHERE pi.purchase_id = pu.id)::float8 AS tax_amount
               FROM purchases pu
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
               LEFT JOIN orders po ON po.id = pu.order_id
               LEFT JOIN staff rb ON rb.id = pu.received_by_staff_id
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

    /**
     * Aggregate paid amount for one Order, from the Purchase(s) created when
     * that order was received (order_id-linked, possibly more than one for a
     * partially-received order delivered in batches). Reuses the same FIFO
     * allocation of supplier_payments as withPaymentStatus/list() above, just
     * summed by order instead of returned per-purchase. Returns null for an
     * order that hasn't been received yet — no linked purchase exists, so
     * there's nothing paid or billed against it.
     *
     * Note: purchases.total_amount is qty × cost_price only (no discount/tax
     * — see create() above), while the Order's own total_price includes
     * both. The caller (ordersRepository.getById) clamps this raw paid
     * figure against the order's real total_price rather than this method
     * inventing a prorated split — see the comment there.
     */
    async getOrderPaymentSummary(orderId: string, supplierId: string, salonId: string): Promise<{ amount_paid: number } | null> {
        const { rows: linked } = await pool.query(
            `SELECT id FROM purchases WHERE order_id = $1 AND salon_id = $2`,
            [orderId, salonId],
        );
        if (!linked.length) return null;
        const linkedIds = new Set(linked.map((r) => r.id));

        const { rows: paidRows } = await pool.query(
            `SELECT COALESCE(SUM(amount), 0)::float8 AS total_paid
               FROM supplier_payments
              WHERE supplier_id = $1 AND salon_id = $2`,
            [supplierId, salonId],
        );
        let remainingCredit = Number(paidRows[0].total_paid) || 0;

        const { rows: allPurchases } = await pool.query(
            `SELECT id, total_amount FROM purchases
              WHERE supplier_id = $1 AND salon_id = $2
              ORDER BY purchase_date ASC, created_at ASC`,
            [supplierId, salonId],
        );

        let amountPaid = 0;
        for (const p of allPurchases) {
            const total = Number(p.total_amount) || 0;
            const applied = Math.min(remainingCredit, total);
            remainingCredit -= applied;
            if (linkedIds.has(p.id)) amountPaid += applied;
        }
        return { amount_paid: amountPaid };
    },

    // Powers the Purchase History report's Graph page. Same filter set as
    // list() above, minus pagination.
    _buildChartWhere(filters: PurchaseChartFilters, salonId: string): { where: string; values: unknown[]; nextIndex: number } {
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
        if (filters.date_from) {
            conditions.push(`pu.purchase_date >= $${idx++}`);
            values.push(filters.date_from);
        }
        if (filters.date_to) {
            conditions.push(`pu.purchase_date <= $${idx++}`);
            values.push(filters.date_to);
        }

        return { where: `WHERE ${conditions.join(" AND ")}`, values, nextIndex: idx };
    },

    async chartTrend(
        filters: PurchaseChartFilters,
        salonId: string,
        granularity: "day" | "week" | "month" = "day",
    ): Promise<{ date: string; count: number; amount: number }[]> {
        const { where, values } = this._buildChartWhere(filters, salonId);
        const dayExpr = granularity === "month"
            ? `TO_CHAR(date_trunc('month', pu.purchase_date), 'YYYY-MM-DD')`
            : granularity === "week"
            ? `TO_CHAR(date_trunc('week', pu.purchase_date), 'YYYY-MM-DD')`
            : `TO_CHAR(pu.purchase_date, 'YYYY-MM-DD')`;

        const { rows } = await pool.query(
            `SELECT ${dayExpr} AS day, COUNT(*)::int AS count, COALESCE(SUM(pu.total_amount), 0) AS amount
               FROM purchases pu
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
               ${where}
              GROUP BY day
              ORDER BY day ASC`,
            values,
        );
        return rows.map((r: any) => ({
            date: String(r.day),
            count: Number(r.count ?? 0),
            amount: Math.round(Number(r.amount ?? 0)),
        }));
    },

    async chartTopSuppliers(
        filters: PurchaseChartFilters,
        salonId: string,
        limit: number = 5,
    ): Promise<{ supplier_id: string | null; supplier_name: string; amount: number }[]> {
        const { where, values, nextIndex } = this._buildChartWhere(filters, salonId);

        const { rows } = await pool.query(
            `SELECT pu.supplier_id, COALESCE(sup.name, 'Unknown') AS supplier_name,
                    COALESCE(SUM(pu.total_amount), 0) AS amount
               FROM purchases pu
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
               ${where}
              GROUP BY pu.supplier_id, sup.name
              ORDER BY amount DESC
              LIMIT $${nextIndex}`,
            [...values, limit],
        );
        return rows.map((r: any) => ({
            supplier_id: r.supplier_id ? String(r.supplier_id) : null,
            supplier_name: r.supplier_name,
            amount: Math.round(Number(r.amount ?? 0)),
        }));
    },

    async chartTopProducts(
        filters: PurchaseChartFilters,
        salonId: string,
        limit: number = 5,
    ): Promise<{ product_name: string; quantity: number; amount: number }[]> {
        const { where, values, nextIndex } = this._buildChartWhere(filters, salonId);

        const { rows } = await pool.query(
            `SELECT p.name AS product_name,
                    COALESCE(SUM(pi.quantity), 0) AS quantity,
                    COALESCE(SUM(pi.total_price), 0) AS amount
               FROM purchase_items pi
               JOIN purchases pu ON pu.id = pi.purchase_id
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
               JOIN products p ON p.id = pi.product_id
               ${where}
              GROUP BY p.name
              ORDER BY amount DESC
              LIMIT $${nextIndex}`,
            [...values, limit],
        );
        return rows.map((r: any) => ({
            product_name: String(r.product_name ?? "—"),
            quantity: Number(r.quantity ?? 0),
            amount: Math.round(Number(r.amount ?? 0)),
        }));
    },

    async getById(id: string, salonId: string): Promise<Purchase | null> {
        const { rows: purchaseRows } = await pool.query(
            `SELECT pu.*, sup.name AS supplier_name, po.order_number AS po_number,
                    ${historicalBillSql("pu")} AS is_historical,
                    NULLIF(TRIM(CONCAT(rb.first_name, ' ', COALESCE(rb.last_name, ''))), '') AS received_by_name
               FROM purchases pu
               LEFT JOIN suppliers sup ON sup.id = pu.supplier_id
               LEFT JOIN orders po ON po.id = pu.order_id
               LEFT JOIN staff rb ON rb.id = pu.received_by_staff_id
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
