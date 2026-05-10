import pool from "../../config/database";
import {
    Supplier, CreateSupplierBody, UpdateSupplierBody,
    StockMovement, CreateStockMovementBody, ListStockMovementsFilters,
} from "./inventory.types";

// ─── Suppliers ────────────────────────────────────────────────────────────────

export const suppliersRepository = {
    async findById(id: string, salonId: string): Promise<Supplier | null> {
        const { rows } = await pool.query(
            `SELECT * FROM suppliers WHERE id = $1 AND salon_id = $2`, [id, salonId]
        );
        return rows[0] || null;
    },

    async listAll(salonId: string): Promise<Supplier[]> {
        const { rows } = await pool.query(
            `SELECT * FROM suppliers WHERE salon_id = $1 ORDER BY created_at DESC`, [salonId]
        );
        return rows;
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
                }
            }

            await client.query("COMMIT");
            return movements;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },
};
