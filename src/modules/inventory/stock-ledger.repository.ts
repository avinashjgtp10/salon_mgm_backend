import pool from "../../config/database";
import {
    StockLedgerEntry,
    CreateStockLedgerEntryBody,
    UpdateStockLedgerEntryBody,
    ListStockLedgerFilters,
    StockLedgerSummary,
    STOCK_LEDGER_IN_TYPES,
} from "./stock-ledger.types";
import { inventoryAlertsService } from "./inventory-alerts.service";

// Shared SELECT list + joins so list/findById/getTimeline all project the
// same shape — product name/category for display, created_by resolved to a
// human name the same way product-audit resolves auditor_name.
const SELECT_WITH_JOINS = `
    SELECT sl.*,
           p.name AS product_name,
           p.measure_unit AS measure_unit,
           p.bottle_size AS bottle_size,
           sc.name AS category,
           sup.name AS supplier_name,
           NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS created_by_name
    FROM stock_ledger sl
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN service_categories sc ON sc.id = p.category_id
    LEFT JOIN suppliers sup ON sup.id = sl.supplier_id
    LEFT JOIN users u ON u.id = sl.created_by`;

export const stockLedgerRepository = {
    async findById(id: string, salonId: string): Promise<StockLedgerEntry | null> {
        const { rows } = await pool.query(
            `${SELECT_WITH_JOINS} WHERE sl.id = $1 AND sl.salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async list(filters: ListStockLedgerFilters, salonId: string): Promise<{ data: StockLedgerEntry[]; total: number }> {
        const conditions: string[] = [`sl.salon_id = $1`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.branch_id) { conditions.push(`sl.branch_id = $${idx++}`); values.push(filters.branch_id); }
        if (filters.product_id) { conditions.push(`sl.product_id = $${idx++}`); values.push(filters.product_id); }
        if (filters.category_id) { conditions.push(`p.category_id = $${idx++}`); values.push(filters.category_id); }
        if (filters.transaction_type) { conditions.push(`sl.transaction_type = $${idx++}`); values.push(filters.transaction_type); }
        if (filters.staff_id) { conditions.push(`sl.created_by = $${idx++}`); values.push(filters.staff_id); }
        if (filters.search) { conditions.push(`p.name ILIKE $${idx++}`); values.push(`%${filters.search}%`); }
        if (filters.from_date) { conditions.push(`sl.created_at >= $${idx++}`); values.push(filters.from_date); }
        if (filters.to_date) { conditions.push(`sl.created_at <= $${idx++}`); values.push(filters.to_date); }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 25;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM stock_ledger sl
             JOIN products p ON p.id = sl.product_id
             ${where}`,
            values
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `${SELECT_WITH_JOINS}
             ${where}
             ORDER BY sl.created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset]
        );

        return { data: rows, total };
    },

    // Full movement history for one product, oldest constraints untouched —
    // powers the Stock Movement Timeline shown when opening a product.
    async getTimelineForProduct(productId: string, salonId: string): Promise<StockLedgerEntry[]> {
        const { rows } = await pool.query(
            `${SELECT_WITH_JOINS}
             WHERE sl.product_id = $1 AND sl.salon_id = $2
             ORDER BY sl.created_at DESC`,
            [productId, salonId]
        );
        return rows;
    },

    async getSummary(filters: ListStockLedgerFilters, salonId: string): Promise<StockLedgerSummary> {
        const conditions: string[] = [`sl.salon_id = $1`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.branch_id) { conditions.push(`sl.branch_id = $${idx++}`); values.push(filters.branch_id); }
        if (filters.product_id) { conditions.push(`sl.product_id = $${idx++}`); values.push(filters.product_id); }
        if (filters.category_id) { conditions.push(`p.category_id = $${idx++}`); values.push(filters.category_id); }
        if (filters.transaction_type) { conditions.push(`sl.transaction_type = $${idx++}`); values.push(filters.transaction_type); }
        if (filters.staff_id) { conditions.push(`sl.created_by = $${idx++}`); values.push(filters.staff_id); }
        if (filters.search) { conditions.push(`p.name ILIKE $${idx++}`); values.push(`%${filters.search}%`); }
        if (filters.from_date) { conditions.push(`sl.created_at >= $${idx++}`); values.push(filters.from_date); }
        if (filters.to_date) { conditions.push(`sl.created_at <= $${idx++}`); values.push(filters.to_date); }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const inTypesList = STOCK_LEDGER_IN_TYPES.map((t) => `'${t}'`).join(", ");

        const { rows } = await pool.query(
            `SELECT
                COUNT(DISTINCT sl.product_id) AS total_products,
                COALESCE(SUM(sl.quantity) FILTER (WHERE sl.transaction_type IN (${inTypesList})), 0)
                  - COALESCE(SUM(sl.quantity) FILTER (WHERE sl.transaction_type NOT IN (${inTypesList})), 0)
                  AS total_stock,
                COALESCE(SUM(sl.quantity) FILTER (WHERE sl.transaction_type IN (${inTypesList})), 0) AS stock_in,
                COALESCE(ABS(SUM(sl.quantity) FILTER (WHERE sl.transaction_type NOT IN (${inTypesList}))), 0) AS stock_out
             FROM stock_ledger sl
             JOIN products p ON p.id = sl.product_id
             ${where}`,
            values
        );

        const row = rows[0];
        return {
            total_products: parseInt(row.total_products, 10) || 0,
            total_stock: parseFloat(row.total_stock) || 0,
            stock_in: parseFloat(row.stock_in) || 0,
            stock_out: parseFloat(row.stock_out) || 0,
        };
    },

    // Locks the product row so a concurrent write can't read a stale balance
    // between this SELECT and the INSERT below — same pattern as
    // consumableUsageRepository.create in inventory.repository.ts.
    async create(data: CreateStockLedgerEntryBody, createdBy: string, salonId: string): Promise<StockLedgerEntry> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: prodRows } = await client.query(
                `SELECT id, COALESCE(amount, 0) AS amount FROM products
                 WHERE id = $1 AND salon_id = $2
                 FOR UPDATE`,
                [data.product_id, salonId]
            );
            if (!prodRows.length) throw new Error("Product not found in this salon");

            const isInType = STOCK_LEDGER_IN_TYPES.includes(data.transaction_type);
            const signedQty = isInType ? Math.abs(data.quantity) : -Math.abs(data.quantity);
            const balanceAfter = parseFloat(prodRows[0].amount) + signedQty;

            const { rows } = await client.query(
                `INSERT INTO stock_ledger (
                    salon_id, branch_id, product_id, transaction_type,
                    reference, quantity, unit_cost, balance_after, reason, notes, created_by, supplier_id
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 RETURNING *`,
                [
                    salonId, data.branch_id, data.product_id, data.transaction_type,
                    data.reference ?? null, signedQty, data.unit_cost ?? null,
                    balanceAfter, data.reason ?? null, data.notes ?? null, createdBy, data.supplier_id ?? null,
                ]
            );

            await client.query(
                `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2`,
                [balanceAfter, data.product_id]
            );

            await client.query("COMMIT");

            inventoryAlertsService
                .checkAndNotify([data.product_id], salonId)
                .catch(() => { /* logged internally, never blocks the caller */ });

            const created = await this.findById(rows[0].id, salonId);
            return created as StockLedgerEntry;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async update(id: string, data: UpdateStockLedgerEntryBody, salonId: string): Promise<StockLedgerEntry | null> {
        const sets: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (data.reference !== undefined) { sets.push(`reference = $${idx++}`); values.push(data.reference); }
        if (data.reason !== undefined) { sets.push(`reason = $${idx++}`); values.push(data.reason); }
        if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(data.notes); }
        if (data.supplier_id !== undefined) { sets.push(`supplier_id = $${idx++}`); values.push(data.supplier_id || null); }
        if (sets.length === 0) return this.findById(id, salonId);

        sets.push(`updated_at = NOW()`);
        values.push(id, salonId);

        const { rows } = await pool.query(
            `UPDATE stock_ledger SET ${sets.join(", ")}
             WHERE id = $${idx++} AND salon_id = $${idx++}
             RETURNING id`,
            values
        );
        if (!rows.length) return null;
        return this.findById(id, salonId);
    },

    // Deleting a ledger row does NOT reverse its effect on products.amount —
    // this is a correction tool for a mis-entered reference/reason row, not
    // an undo. Reversing stock requires a new, opposite ledger entry instead
    // so the audit trail still shows both the mistake and its correction.
    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM stock_ledger WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },

    // Writes one 'sale' ledger row + products.amount deduction per retail
    // product line in a completed sale — see stockDeductionService.deductForSale
    // for the fire-and-forget call sites (every checkout path). `reference`
    // is the human-readable invoice number (what the "Reference" field shows
    // everywhere else in this table — a Purchase Order number, a manual
    // entry's typed reference, etc), NOT the sale's raw UUID. The UUID still
    // needs to be tracked somewhere for idempotency (a re-entered checkout —
    // see appointments.service.ts's pre-existing-sale branch — must not
    // deduct stock twice), so it's tucked into `notes` instead, a column
    // nothing in the UI currently renders. Skipping (not reversing) on a
    // repeat call is the safer default: a wrong SKIP just leaves an
    // already-correct balance alone, while a wrong double-deduct silently
    // corrupts stock.
    async deductForSale(
        params: { salonId: string; branchId: string; saleId: string; invoiceNumber: string | null; items: { product_id: string; quantity: number }[] },
        createdBy: string | null,
    ): Promise<void> {
        const { salonId, branchId, saleId, invoiceNumber, items } = params;
        if (!items.length) return;

        const idempotencyTag = `sale_id:${saleId}`;
        const displayReference = invoiceNumber || "Sale";

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: existing } = await client.query(
                `SELECT 1 FROM stock_ledger
                  WHERE salon_id = $1 AND transaction_type = 'sale' AND notes = $2
                  LIMIT 1`,
                [salonId, idempotencyTag],
            );
            if (existing.length) {
                await client.query("ROLLBACK");
                return;
            }

            for (const item of items) {
                if (!(item.quantity > 0)) continue;

                const { rows: prodRows } = await client.query(
                    `SELECT id, COALESCE(amount, 0) AS amount, bottle_size FROM products
                      WHERE id = $1 AND salon_id = $2
                      FOR UPDATE`,
                    [item.product_id, salonId],
                );
                if (!prodRows.length) continue; // product deleted/not found — nothing to deduct

                // item.quantity is a count of retail units/bottles sold, but
                // products.amount is base units (ml/g) whenever bottle_size is
                // set — same conversion product-inventory.repository.ts#stockIn
                // and purchases.repository.ts#create already apply on the way
                // in. Without it, selling 1 bottle only deducted 1 base unit.
                const bottleSize = Number(prodRows[0].bottle_size) || 0;
                const baseUnitsPerPack = bottleSize > 0 ? bottleSize : 1;
                const signedQty = -Math.abs(item.quantity) * baseUnitsPerPack;
                const balanceAfter = parseFloat(prodRows[0].amount) + signedQty;

                await client.query(
                    `INSERT INTO stock_ledger (
                        salon_id, branch_id, product_id, transaction_type,
                        reference, quantity, balance_after, notes, created_by
                     ) VALUES ($1,$2,$3,'sale',$4,$5,$6,$7,$8)`,
                    [salonId, branchId, item.product_id, displayReference, signedQty, balanceAfter, idempotencyTag, createdBy],
                );

                await client.query(
                    `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2`,
                    [balanceAfter, item.product_id],
                );
            }

            await client.query("COMMIT");
            inventoryAlertsService
                .checkAndNotify(items.map((i) => i.product_id), salonId)
                .catch(() => { /* logged internally, never blocks the caller */ });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    // Finds every retail product, across every salon, whose ENTIRE stock has
    // expired — see expiryWriteOffScheduler for why "entire": expiry is
    // tracked per purchase batch (purchase_items.expiry_date), but
    // products.amount is one pooled total with no per-batch breakdown, so a
    // product with a mix of expired and still-good batches can't be safely
    // auto-deducted (would wipe out the still-good portion too). A product
    // is only "entire stock expired" when its LATEST batch's expiry_date has
    // passed — falling back to the product's own manual expiry_date when it
    // has no purchase history, same COALESCE product-inventory.repository.ts
    // uses for its own 'expired' status label.
    async findFullyExpiredProducts(): Promise<{ id: string; salon_id: string; amount: number }[]> {
        const { rows } = await pool.query(
            `SELECT p.id, p.salon_id, COALESCE(p.amount, 0)::float8 AS amount
               FROM products p
               LEFT JOIN (
                 SELECT pi.product_id, MAX(pi.expiry_date) AS latest_expiry
                   FROM purchase_items pi
                   JOIN purchases pu ON pu.id = pi.purchase_id
                  WHERE pi.expiry_date IS NOT NULL
                  GROUP BY pi.product_id
               ) expiry_agg ON expiry_agg.product_id = p.id
              WHERE COALESCE(p.product_type, 'retail') IN ('retail', 'both')
                AND COALESCE(p.is_active, TRUE) = TRUE
                AND COALESCE(p.amount, 0) > 0
                AND COALESCE(expiry_agg.latest_expiry, p.expiry_date) < CURRENT_DATE`,
        );
        return rows;
    },

    // Writes off one product's full remaining stock as expired — one
    // stock_ledger 'expired' row + products.amount → 0. Idempotent per
    // product via the caller's daily sweep window (see
    // expiryWriteOffScheduler): once amount hits 0 here, this product no
    // longer matches findFullyExpiredProducts' `amount > 0` filter, so a
    // re-run never double-writes-off the same batch.
    async writeOffExpiredProduct(
        params: { salonId: string; branchId: string; productId: string; amount: number },
    ): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: prodRows } = await client.query(
                `SELECT id, COALESCE(amount, 0) AS amount FROM products
                  WHERE id = $1 AND salon_id = $2
                  FOR UPDATE`,
                [params.productId, params.salonId],
            );
            if (!prodRows.length) { await client.query("ROLLBACK"); return; }

            const currentAmount = parseFloat(prodRows[0].amount);
            if (currentAmount <= 0) { await client.query("ROLLBACK"); return; }

            await client.query(
                `INSERT INTO stock_ledger (
                    salon_id, branch_id, product_id, transaction_type,
                    reference, quantity, balance_after, reason
                 ) VALUES ($1,$2,$3,'expired',$4,$5,0,$6)`,
                [params.salonId, params.branchId, params.productId, "Auto write-off (all batches expired)", -currentAmount, "Expired"],
            );

            await client.query(
                `UPDATE products SET amount = 0, updated_at = NOW() WHERE id = $1`,
                [params.productId],
            );

            await client.query("COMMIT");
            inventoryAlertsService
                .checkAndNotify([params.productId], params.salonId)
                .catch(() => { /* logged internally, never blocks the caller */ });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
