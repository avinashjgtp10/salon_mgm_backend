import pool from "../../config/database";
import {
    Supplier,
    CreateSupplierBody,
    UpdateSupplierBody,
    StockMovement,
    CreateStockMovementBody,
    ListStockMovementsFilters,
} from "./inventory.types";

// ─── Suppliers ────────────────────────────────────────────────────────────────

export const suppliersRepository = {
    async findById(id: string): Promise<Supplier | null> {
        const { rows } = await pool.query(`SELECT * FROM suppliers WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async listAll(): Promise<Supplier[]> {
        const { rows } = await pool.query(
            `SELECT * FROM suppliers ORDER BY created_at DESC`
        );
        return rows;
    },

    async create(data: CreateSupplierBody): Promise<Supplier> {
        const { rows } = await pool.query(
            `INSERT INTO suppliers (
        name, description,
        first_name, last_name,
        mobile_country_code, mobile_number,
        telephone_country_code, telephone_number,
        email, website,
        street, suburb, city, state, zip_code, country,
        same_as_physical,
        postal_street, postal_suburb, postal_city,
        postal_state, postal_zip_code, postal_country
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23
      )
      RETURNING *`,
            [
                data.name,
                data.description ?? null,
                data.first_name ?? null,
                data.last_name ?? null,
                data.mobile_country_code ?? null,
                data.mobile_number ?? null,
                data.telephone_country_code ?? null,
                data.telephone_number ?? null,
                data.email ?? null,
                data.website ?? null,
                data.street ?? null,
                data.suburb ?? null,
                data.city ?? null,
                data.state ?? null,
                data.zip_code ?? null,
                data.country ?? null,
                data.same_as_physical ?? true,
                data.postal_street ?? null,
                data.postal_suburb ?? null,
                data.postal_city ?? null,
                data.postal_state ?? null,
                data.postal_zip_code ?? null,
                data.postal_country ?? null,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateSupplierBody): Promise<Supplier> {
        const keys = Object.keys(patch) as (keyof UpdateSupplierBody)[];

        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM suppliers WHERE id = $1`, [id]);
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

        const { rows } = await pool.query(
            `UPDATE suppliers
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );
        return rows[0];
    },

    async delete(id: string): Promise<void> {
        await pool.query(`DELETE FROM suppliers WHERE id = $1`, [id]);
    },
};

// ─── Stock Movements ──────────────────────────────────────────────────────────

export const stockMovementsRepository = {
    async findById(id: string): Promise<StockMovement | null> {
        const { rows } = await pool.query(`SELECT * FROM stock_movements WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async list(
        filters: ListStockMovementsFilters
    ): Promise<{ data: StockMovement[]; total: number }> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (filters.product_id) { conditions.push(`product_id = $${idx++}`); values.push(filters.product_id); }
        if (filters.branch_id) { conditions.push(`branch_id = $${idx++}`); values.push(filters.branch_id); }
        if (filters.supplier_id) { conditions.push(`supplier_id = $${idx++}`); values.push(filters.supplier_id); }
        if (filters.movement_type) { conditions.push(`movement_type = $${idx++}`); values.push(filters.movement_type); }
        if (filters.from_date) { conditions.push(`created_at >= $${idx++}`); values.push(filters.from_date); }
        if (filters.to_date) { conditions.push(`created_at <= $${idx++}`); values.push(filters.to_date); }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM stock_movements ${where}`,
            values
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT * FROM stock_movements ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset]
        );

        return { data: rows, total };
    },

    async create(data: CreateStockMovementBody, createdBy: string): Promise<StockMovement> {
        const { rows } = await pool.query(
            `INSERT INTO stock_movements (
        branch_id, product_id, supplier_id,
        movement_type, quantity, unit_price, total_amount,
        notes, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
            [
                data.branch_id,
                data.product_id,
                data.supplier_id ?? null,
                data.movement_type,
                data.quantity,
                data.unit_price ?? null,
                data.total_amount ?? null,
                data.notes ?? null,
                createdBy,
            ]
        );
        return rows[0];
    },
};

// ─── Stock Take ───────────────────────────────────────────────────────────────

export const stockTakeRepository = {
    async process(params: {
        branch_id: string;
        notes?: string;
        items: { product_id: string; actual_qty: number; notes?: string }[];
        created_by: string;
    }): Promise<StockMovement[]> {
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            const movements: StockMovement[] = [];

            for (const item of params.items) {
                // Calculate current stock for this product + branch
                const { rows: stockRows } = await client.query(
                    `SELECT COALESCE(
             SUM(CASE WHEN movement_type IN ('in','adjustment') THEN quantity ELSE -quantity END),
             0
           ) AS current_qty
           FROM stock_movements
           WHERE product_id = $1 AND branch_id = $2`,
                    [item.product_id, params.branch_id]
                );

                const currentQty = parseInt(stockRows[0].current_qty, 10);
                const diff = item.actual_qty - currentQty;

                // Only write a movement when there is a discrepancy
                if (diff !== 0) {
                    const movementType = diff > 0 ? "in" : "out";
                    const adjustQty = Math.abs(diff);

                    const { rows } = await client.query(
                        `INSERT INTO stock_movements (
              branch_id, product_id,
              movement_type, quantity,
              notes, created_by
            )
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING *`,
                        [
                            params.branch_id,
                            item.product_id,
                            movementType,
                            adjustQty,
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
