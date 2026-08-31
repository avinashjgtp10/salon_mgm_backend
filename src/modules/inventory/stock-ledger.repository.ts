import pool from "../../config/database";
import {
    StockLedgerEntry,
    CreateStockLedgerEntryBody,
    UpdateStockLedgerEntryBody,
    ListStockLedgerFilters,
    StockLedgerSummary,
    STOCK_LEDGER_IN_TYPES,
} from "./stock-ledger.types";

// Shared SELECT list + joins so list/findById/getTimeline all project the
// same shape — product name/category for display, created_by resolved to a
// human name the same way product-audit resolves auditor_name.
const SELECT_WITH_JOINS = `
    SELECT sl.*,
           p.name AS product_name,
           p.measure_unit AS measure_unit,
           p.bottle_size AS bottle_size,
           sc.name AS category,
           NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS created_by_name
    FROM stock_ledger sl
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN service_categories sc ON sc.id = p.category_id
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

            const isInType = ["opening_stock", "purchase", "return", "adjustment_in", "transfer_in"]
                .includes(data.transaction_type);
            const signedQty = isInType ? Math.abs(data.quantity) : -Math.abs(data.quantity);
            const balanceAfter = parseFloat(prodRows[0].amount) + signedQty;

            const { rows } = await client.query(
                `INSERT INTO stock_ledger (
                    salon_id, branch_id, product_id, transaction_type,
                    reference, quantity, unit_cost, balance_after, reason, notes, created_by
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING *`,
                [
                    salonId, data.branch_id, data.product_id, data.transaction_type,
                    data.reference ?? null, signedQty, data.unit_cost ?? null,
                    balanceAfter, data.reason ?? null, data.notes ?? null, createdBy,
                ]
            );

            await client.query(
                `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2`,
                [balanceAfter, data.product_id]
            );

            await client.query("COMMIT");

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
};
