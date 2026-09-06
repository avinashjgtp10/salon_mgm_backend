import pool from "../../config/database";
import {
    Supplier, CreateSupplierBody, UpdateSupplierBody, SupplierWithBalance,
    StockMovement, CreateStockMovementBody, ListStockMovementsFilters,
    StockReconciliationRow, SaveConsumableUsageBody,
} from "./inventory.types";
import { inventoryAlertsService } from "./inventory-alerts.service";

// ─── Suppliers ────────────────────────────────────────────────────────────────

// due_amount/status are DERIVED from purchases.total_amount minus
// SUM(supplier_payments.amount) — see Migration/add_supplier_payments.sql's
// header comment for why there's no stored balance column to keep in sync.
// pending_order_count counts orders still carrying a due amount once the
// supplier's total payments are applied oldest-first (FIFO) across their
// orders — a running-total window over purchases ordered by date, same
// allocation purchasesRepository.list() projects per-row for the Orders tab.
const BALANCE_COLUMNS = `
    COALESCE(agg.total_purchase_amount, 0) AS total_purchase_amount,
    COALESCE(agg.pending_order_count, 0)   AS pending_order_count,
    GREATEST(COALESCE(agg.total_purchase_amount, 0) - COALESCE(pay.total_paid, 0), 0) AS due_amount,
    agg.earliest_unpaid_date AS due_date,
    CASE
      WHEN GREATEST(COALESCE(agg.total_purchase_amount, 0) - COALESCE(pay.total_paid, 0), 0) <= 0 THEN 'paid'
      WHEN agg.earliest_unpaid_date IS NOT NULL AND agg.earliest_unpaid_date < CURRENT_DATE THEN 'overdue'
      ELSE 'due'
    END AS status
`;

const BALANCE_JOINS = `
    LEFT JOIN (
      SELECT supplier_id,
             SUM(total_amount) AS total_purchase_amount,
             -- An order is still "pending" once cumulative orders-so-far
             -- (this one included, oldest-first) exceed the supplier's total
             -- payments — i.e. the payment pool hasn't reached this order yet.
             COUNT(*) FILTER (WHERE cumulative_total > total_paid) AS pending_order_count,
             MIN(purchase_date) FILTER (WHERE cumulative_total > total_paid) AS earliest_unpaid_date
        FROM (
          SELECT p.supplier_id, p.purchase_date, p.total_amount,
                 COALESCE(pay.total_paid, 0) AS total_paid,
                 SUM(p.total_amount) OVER (
                   PARTITION BY p.supplier_id
                   ORDER BY p.purchase_date, p.created_at
                 ) AS cumulative_total
            FROM purchases p
            LEFT JOIN (
              SELECT supplier_id, SUM(amount) AS total_paid
                FROM supplier_payments
               WHERE salon_id = $1
               GROUP BY supplier_id
            ) pay ON pay.supplier_id = p.supplier_id
           WHERE p.salon_id = $1
        ) per_order
       GROUP BY supplier_id
    ) agg ON agg.supplier_id = s.id
    LEFT JOIN (
      SELECT supplier_id, SUM(amount) AS total_paid
        FROM supplier_payments
       WHERE salon_id = $1
       GROUP BY supplier_id
    ) pay ON pay.supplier_id = s.id
`;

export const suppliersRepository = {
    async findById(id: string, salonId: string): Promise<Supplier | null> {
        const { rows } = await pool.query(
            `SELECT * FROM suppliers WHERE id = $1 AND salon_id = $2`, [id, salonId]
        );
        return rows[0] || null;
    },

    async findByIdWithBalance(id: string, salonId: string): Promise<SupplierWithBalance | null> {
        const { rows } = await pool.query(
            `SELECT s.*, ${BALANCE_COLUMNS}
               FROM suppliers s
               ${BALANCE_JOINS}
              WHERE s.id = $2 AND s.salon_id = $1`,
            [salonId, id],
        );
        return rows[0] || null;
    },

    async listAll(salonId: string): Promise<Supplier[]> {
        const { rows } = await pool.query(
            `SELECT * FROM suppliers WHERE salon_id = $1 ORDER BY created_at DESC`, [salonId]
        );
        return rows;
    },

    async listAllWithBalance(salonId: string): Promise<SupplierWithBalance[]> {
        const { rows } = await pool.query(
            `SELECT s.*, ${BALANCE_COLUMNS}
               FROM suppliers s
               ${BALANCE_JOINS}
              WHERE s.salon_id = $1
              ORDER BY s.created_at DESC`,
            [salonId],
        );
        return rows;
    },

    // Real server-side pagination (COUNT + LIMIT/OFFSET) for the Suppliers
    // list page — listAllWithBalance above loads every supplier at once and
    // paginates client-side, which is what this replaces.
    async listPaginatedWithBalance(
        salonId: string,
        page: number,
        limit: number,
        filters?: { search?: string; city?: string; state?: string },
    ): Promise<{ data: SupplierWithBalance[]; total: number }> {
        const conditions: string[] = [`s.salon_id = $1`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters?.search) {
            conditions.push(`(s.name ILIKE $${idx} OR s.first_name ILIKE $${idx} OR s.last_name ILIKE $${idx} OR s.email ILIKE $${idx})`);
            values.push(`%${filters.search}%`);
            idx++;
        }
        if (filters?.city) { conditions.push(`s.city = $${idx++}`); values.push(filters.city); }
        if (filters?.state) { conditions.push(`s.state = $${idx++}`); values.push(filters.state); }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const safePage = Math.max(1, page);
        const safeLimit = Math.min(100, Math.max(1, limit));
        const offset = (safePage - 1) * safeLimit;

        const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM suppliers s ${where}`, values);
        const total = countRes.rows[0]?.total ?? 0;

        const { rows } = await pool.query(
            `SELECT s.*, ${BALANCE_COLUMNS}
               FROM suppliers s
               ${BALANCE_JOINS}
              ${where}
              ORDER BY s.created_at DESC
              LIMIT $${idx} OFFSET $${idx + 1}`,
            [...values, safeLimit, offset],
        );
        return { data: rows, total };
    },

    // Distinct city/state values across EVERY supplier (not just the current
    // page) — backs the City/State filter dropdown's own option list, which
    // needs the full set regardless of which page is currently loaded.
    async listDistinctLocations(salonId: string): Promise<{ cities: string[]; states: string[] }> {
        const { rows } = await pool.query(
            `SELECT DISTINCT city, state FROM suppliers WHERE salon_id = $1 AND (city IS NOT NULL OR state IS NOT NULL)`,
            [salonId],
        );
        const cities = new Set<string>();
        const states = new Set<string>();
        for (const r of rows) {
            if (r.city?.trim()) cities.add(r.city.trim());
            if (r.state?.trim()) states.add(r.state.trim());
        }
        return { cities: Array.from(cities).sort(), states: Array.from(states).sort() };
    },

    async findByName(name: string, salonId: string): Promise<Supplier | null> {
        const { rows } = await pool.query(
            `SELECT * FROM suppliers WHERE LOWER(name) = LOWER($1) AND salon_id = $2`,
            [name, salonId]
        );
        return rows[0] || null;
    },

    async create(data: CreateSupplierBody, salonId: string): Promise<Supplier> {
        const { rows } = await pool.query(
            `INSERT INTO suppliers (
        salon_id, name, description,
        first_name, last_name,
        mobile_country_code, mobile_number,
        telephone_country_code, telephone_number,
        email, website,
        street, suburb, city, state, zip_code, country,
        same_as_physical,
        postal_street, postal_suburb, postal_city,
        postal_state, postal_zip_code, postal_country
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,$24
      ) RETURNING *`,
            [
                salonId, data.name, data.description ?? null,
                data.first_name ?? null, data.last_name ?? null,
                data.mobile_country_code ?? null, data.mobile_number ?? null,
                data.telephone_country_code ?? null, data.telephone_number ?? null,
                data.email ?? null, data.website ?? null,
                data.street ?? null, data.suburb ?? null, data.city ?? null,
                data.state ?? null, data.zip_code ?? null, data.country ?? null,
                data.same_as_physical ?? true,
                data.postal_street ?? null, data.postal_suburb ?? null, data.postal_city ?? null,
                data.postal_state ?? null, data.postal_zip_code ?? null, data.postal_country ?? null,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateSupplierBody, salonId: string): Promise<Supplier> {
        const keys = Object.keys(patch) as (keyof UpdateSupplierBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(
                `SELECT * FROM suppliers WHERE id = $1 AND salon_id = $2`, [id, salonId]
            );
            return rows[0];
        }
        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, idx) => {
            setParts.push(`${k} = $${idx + 1}`);
            values.push((patch as Record<string, unknown>)[k]);
        });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        values.push(salonId);
        const { rows } = await pool.query(
            `UPDATE suppliers SET ${setParts.join(", ")}
             WHERE id = $${values.length - 1} AND salon_id = $${values.length}
             RETURNING *`,
            values
        );
        return rows[0];
    },

    async delete(id: string, salonId: string): Promise<void> {
        await pool.query(`DELETE FROM suppliers WHERE id = $1 AND salon_id = $2`, [id, salonId]);
    },
};

// ─── Stock Movements ──────────────────────────────────────────────────────────

export const stockMovementsRepository = {
    async findById(id: string, salonId: string): Promise<StockMovement | null> {
        const { rows } = await pool.query(
            `SELECT sm.* FROM stock_movements sm
             JOIN products p ON p.id = sm.product_id
             WHERE sm.id = $1 AND p.salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async list(filters: ListStockMovementsFilters, salonId: string): Promise<{ data: StockMovement[]; total: number }> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        // Scope via products.salon_id join
        conditions.push(`p.salon_id = $${idx++}`);
        values.push(salonId);

        if (filters.product_id) { conditions.push(`sm.product_id = $${idx++}`); values.push(filters.product_id); }
        if (filters.branch_id) { conditions.push(`sm.branch_id = $${idx++}`); values.push(filters.branch_id); }
        if (filters.supplier_id) { conditions.push(`sm.supplier_id = $${idx++}`); values.push(filters.supplier_id); }
        if (filters.movement_type) { conditions.push(`sm.movement_type = $${idx++}`); values.push(filters.movement_type); }
        if (filters.from_date) { conditions.push(`sm.created_at >= $${idx++}`); values.push(filters.from_date); }
        if (filters.to_date) { conditions.push(`sm.created_at <= $${idx++}`); values.push(filters.to_date); }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM stock_movements sm JOIN products p ON p.id = sm.product_id ${where}`, values
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT sm.* FROM stock_movements sm
             JOIN products p ON p.id = sm.product_id
             ${where}
             ORDER BY sm.created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset]
        );

        return { data: rows, total };
    },

    async create(data: CreateStockMovementBody, createdBy: string, salonId: string): Promise<StockMovement> {
        // Verify product belongs to this salon
        const { rows: prodRows } = await pool.query(
            `SELECT id FROM products WHERE id = $1 AND salon_id = $2`, [data.product_id, salonId]
        );
        if (!prodRows.length) throw new Error("Product not found in this salon");

        const { rows } = await pool.query(
            `INSERT INTO stock_movements (
        branch_id, product_id, supplier_id,
        movement_type, quantity, unit_price, total_amount,
        notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
                data.branch_id, data.product_id, data.supplier_id ?? null,
                data.movement_type, data.quantity,
                data.unit_price ?? null, data.total_amount ?? null,
                data.notes ?? null, createdBy,
            ]
        );
        return rows[0];
    },
};

// ─── Stock Reconciliation ─────────────────────────────────────────────────────

export const stockReconciliationRepository = {
    /**
     * Fetch all products for the salon joined with their saved reconciliation
     * data and aggregated consumable usage totals.
     */
    async list(branchId: string, salonId: string, search?: string, categoryId?: string): Promise<StockReconciliationRow[]> {
        const conditions: string[] = [
            `p.salon_id = $1`,
        ];
        const values: unknown[] = [salonId];
        let idx = 3; // $1=salonId, $2=branchId are fixed; extras start at $3

        if (search) {
            conditions.push(`p.name ILIKE $${idx++}`);
            values.push(`%${search}%`);
        }
        if (categoryId) {
            conditions.push(`p.category_id = $${idx++}`);
            values.push(categoryId);
        }

        const where = conditions.join(" AND ");

        const { rows } = await pool.query(
            `SELECT
               p.id                                                          AS product_id,
               COALESCE(c.name, '')                                          AS category_name,
               p.name                                                        AS item_name,
               -- Opt-in bottle-based tracking: amount is always the raw
               -- remaining volume (e.g. ml) — the deduction engine's source
               -- of truth is unchanged. Where bottle_size is set, Stock
               -- Quantity is a DERIVED bottle count (a partially-consumed
               -- bottle still counts as 1 until fully empty — see that
               -- migration's header comment), not the raw volume.
               CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
                    THEN CEIL(COALESCE(p.amount, 0) / p.bottle_size)
                    ELSE COALESCE(p.amount, 0) END                           AS actual_stock,
               COALESCE(sr.adjust_stock,
                 CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
                      THEN CEIL(COALESCE(p.amount, 0) / p.bottle_size)
                      ELSE COALESCE(p.amount, 0) END, 0)                     AS adjust_stock,
               COALESCE(sr.adjust_stock,
                 CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
                      THEN CEIL(COALESCE(p.amount, 0) / p.bottle_size)
                      ELSE COALESCE(p.amount, 0) END, 0)
                 - (CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
                         THEN CEIL(COALESCE(p.amount, 0) / p.bottle_size)
                         ELSE COALESCE(p.amount, 0) END)                     AS stock_difference,
               ROUND(COALESCE(p.amount, 0) * COALESCE(p.retail_price::numeric, 0), 2) AS stock_value,
               COALESCE(SUM(CASE WHEN cu.direction = 'return' THEN -cu.qty ELSE cu.qty END), 0)                AS actual_consumable,
               COALESCE(sr.adjust_consumable, SUM(CASE WHEN cu.direction = 'return' THEN -cu.qty ELSE cu.qty END), 0) AS adjust_consumable,
               COALESCE(p.measure_unit, '—')                                 AS unit,
               COALESCE(sr.adjust_consumable, 0) - COALESCE(SUM(CASE WHEN cu.direction = 'return' THEN -cu.qty ELSE cu.qty END), 0) AS consumable_difference,
               COALESCE(sr.remark, '')                                        AS remark
             FROM products p
             LEFT JOIN service_categories c   ON c.id = p.category_id
             LEFT JOIN stock_reconciliation sr
                    ON sr.product_id = p.id AND sr.branch_id = $2
             LEFT JOIN consumable_usage cu
                    ON cu.product_id = p.id AND cu.branch_id = $2
             WHERE ${where}
             GROUP BY p.id, c.name, p.amount, p.bottle_size, p.retail_price, p.measure_unit,
                      sr.adjust_stock, sr.adjust_consumable, sr.remark
             ORDER BY c.name NULLS LAST, p.name`,
            [salonId, branchId, ...values.slice(1)]
        );
        return rows;
    },
};

// ─── Consumable Usage ─────────────────────────────────────────────────────────

export const consumableUsageRepository = {
    async create(body: SaveConsumableUsageBody, salonId: string, userId: string): Promise<number> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            let recorded = 0;
            for (const item of body.items) {
                // Verify product belongs to this salon; lock the row so a
                // concurrent deduction (e.g. an appointment completing at
                // the same moment) can't read/write past this one.
                const { rows: prodRows } = await client.query(
                    `SELECT id, amount FROM products WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
                    [item.product_id, salonId]
                );
                if (!prodRows.length) continue; // skip unknown products silently

                // Record the usage event. direction is always 'deduct' and
                // source is always 'manual' here — this is the standalone
                // "Update Consumable Items" endpoint; appointment-driven
                // deduction/return goes through inventoryTransactionsRepository
                // instead (see inventory-transactions.repository.ts), which
                // stamps source='appointment_complete'/'appointment_adjustment'
                // so reports can tell the two apart.
                await client.query(
                    `INSERT INTO consumable_usage
                       (salon_id, branch_id, product_id, booking_id, qty, unit, used_by, direction, source)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'deduct', 'manual')`,
                    [
                        salonId, body.branch_id, item.product_id,
                        body.booking_id ?? null, item.qty,
                        item.unit ?? null, userId,
                    ]
                );

                // Reduce actual stock — GREATEST prevents negative qty
                await client.query(
                    `UPDATE products
                     SET amount = GREATEST(amount - $1, 0), updated_at = NOW()
                     WHERE id = $2 AND salon_id = $3`,
                    [item.qty, item.product_id, salonId]
                );

                // Audit trail in stock_movements
                await client.query(
                    `INSERT INTO stock_movements
                       (branch_id, product_id, movement_type, quantity, notes, created_by)
                     VALUES ($1, $2, 'out', $3, $4, $5)`,
                    [
                        body.branch_id, item.product_id, item.qty,
                        `Consumable used in appointment${body.booking_id ? ` (booking ${body.booking_id})` : ''}`,
                        userId,
                    ]
                );

                recorded++;
            }

            await client.query("COMMIT");
            inventoryAlertsService
                .checkAndNotify(body.items.map((i) => i.product_id), salonId)
                .catch(() => { /* logged internally, never blocks the caller */ });
            return recorded;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};

// ─── Stock Takes ──────────────────────────────────────────────────────────────

export const stocktakesRepository = {
    async findById(id: string, salonId: string): Promise<any | null> {
        const { rows } = await pool.query(
            `SELECT st.* FROM stocktakes st
             JOIN branches b ON b.id = st.branch_id
             WHERE st.id = $1 AND b.salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async list(branchId: string, salonId: string): Promise<any[]> {
        const { rows } = await pool.query(
            `SELECT st.* FROM stocktakes st
             JOIN branches b ON b.id = st.branch_id
             WHERE st.branch_id = $1 AND b.salon_id = $2
             ORDER BY st.created_at DESC`,
            [branchId, salonId]
        );
        return rows;
    },

    async create(data: { branch_id: string; name: string; description?: string; started_by: string }, salonId: string): Promise<any> {
        const { rows: branchRows } = await pool.query(
            `SELECT id FROM branches WHERE id = $1 AND salon_id = $2`,
            [data.branch_id, salonId]
        );
        if (!branchRows.length) throw new Error("Branch not found in this salon");

        const { rows } = await pool.query(
            `INSERT INTO stocktakes (branch_id, name, description, started_by, status)
             VALUES ($1, $2, $3, $4, 'In progress') RETURNING *`,
            [data.branch_id, data.name, data.description || null, data.started_by]
        );
        return rows[0];
    },

    async updateStatus(id: string, status: string, salonId: string): Promise<any> {
        const { rows } = await pool.query(
            `UPDATE stocktakes SET status = $1,
             completed_at = CASE WHEN $1 = 'Completed' THEN NOW() ELSE completed_at END,
             updated_at = NOW()
             WHERE id = $2
               AND branch_id IN (SELECT id FROM branches WHERE salon_id = $3)
             RETURNING *`,
            [status, id, salonId]
        );
        return rows[0];
    },

    async delete(id: string, salonId: string): Promise<void> {
        await pool.query(
            `DELETE FROM stocktakes WHERE id = $1
               AND branch_id IN (SELECT id FROM branches WHERE salon_id = $2)`,
            [id, salonId]
        );
    },
};

// ─── Stock Take ───────────────────────────────────────────────────────────────

export const stockTakeRepository = {
    async process(params: {
        stocktake_id?: string;
        branch_id: string;
        notes?: string;
        items: { product_id: string; actual_qty: number; notes?: string }[];
        created_by: string;
        salonId: string;
    }): Promise<StockMovement[]> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Verify branch belongs to this salon before processing
            const { rows: branchRows } = await client.query(
                `SELECT id FROM branches WHERE id = $1 AND salon_id = $2`,
                [params.branch_id, params.salonId]
            );
            if (!branchRows.length) throw new Error("Branch not found in this salon");

            const movements: StockMovement[] = [];

            for (const item of params.items) {
                const { rows: stockRows } = await client.query(
                    `SELECT COALESCE(
                       SUM(CASE WHEN movement_type IN ('in','adjustment') THEN quantity ELSE -quantity END), 0
                     ) AS current_qty
                     FROM stock_movements
                     WHERE product_id = $1 AND branch_id = $2`,
                    [item.product_id, params.branch_id]
                );
                const currentQty = parseInt(stockRows[0].current_qty, 10);
                const diff = item.actual_qty - currentQty;

                if (diff !== 0) {
                    const movementType = diff > 0 ? "in" : "out";
                    const adjustQty = Math.abs(diff);
                    const { rows } = await client.query(
                        `INSERT INTO stock_movements (
                           stocktake_id, branch_id, product_id,
                           movement_type, quantity, notes, created_by
                         ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                        [
                            params.stocktake_id || null, params.branch_id, item.product_id,
                            movementType, adjustQty,
                            item.notes ?? params.notes ?? "Stock take adjustment",
                            params.created_by,
                        ]
                    );
                    movements.push(rows[0]);

                    // The counted quantity is now the source of truth for this
                    // product — without this, completing a stocktake logged a
                    // movement but never actually corrected what Product
                    // Inventory's "Available" column shows (products.amount),
                    // which is what every other stock-writing flow (Purchase,
                    // Add Stock, appointment consumption) updates directly.
                    await client.query(
                        `UPDATE products SET amount = $1, updated_at = NOW() WHERE id = $2 AND salon_id = $3`,
                        [item.actual_qty, item.product_id, params.salonId]
                    );
                }
            }

            await client.query("COMMIT");
            inventoryAlertsService
                .checkAndNotify(params.items.map((i) => i.product_id), params.salonId)
                .catch(() => { /* logged internally, never blocks the caller */ });
            return movements;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
