import pool from "../../config/database";
import {
    Product, CreateProductBody, UpdateProductBody, ProductListFilters,
    ProductPhoto, Brand, CreateBrandBody, UpdateBrandBody,
} from "./products.types";

// ─── Products Repository ──────────────────────────────────────────────────────

export const productsRepository = {
    async findById(id: string): Promise<Product | null> {
        const { rows } = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async list(filters: ProductListFilters): Promise<{ data: Product[]; total: number }> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (filters.search) {
            conditions.push(`(name ILIKE $${idx} OR barcode ILIKE $${idx})`);
            values.push(`%${filters.search}%`);
            idx++;
        }
        if (filters.category_id) {
            conditions.push(`category_id = $${idx++}`);
            values.push(filters.category_id);
        }
        if (filters.brand_id) {
            conditions.push(`brand_id = $${idx++}`);
            values.push(filters.brand_id);
        }
        if (filters.retail_sales_enabled !== undefined) {
            conditions.push(`retail_sales_enabled = $${idx++}`);
            values.push(filters.retail_sales_enabled);
        }
        if (filters.min_price !== undefined) {
            conditions.push(`supply_price >= $${idx++}`);
            values.push(filters.min_price);
        }
        if (filters.max_price !== undefined) {
            conditions.push(`supply_price <= $${idx++}`);
            values.push(filters.max_price);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        const allowedSorts: Record<string, string> = {
            name: "name", created_at: "created_at",
            supply_price: "supply_price", retail_price: "retail_price",
        };
        const orderCol = allowedSorts[filters.sort_by ?? "created_at"] ?? "created_at";
        const orderDir = filters.sort_order === "ASC" ? "ASC" : "DESC";

        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) AS total FROM products ${where}`, values
        );
        const total = parseInt(countRows[0].total, 10);

        const { rows } = await pool.query(
            `SELECT * FROM products ${where} ORDER BY ${orderCol} ${orderDir} LIMIT $${idx++} OFFSET $${idx}`,
            [...values, limit, offset]
        );

        return { data: rows, total };
    },

    async create(data: CreateProductBody): Promise<Product> {
        const { rows } = await pool.query(
            `INSERT INTO products (
        name, barcode, brand_id, category_id, measure_unit, amount,
        short_description, description,
        supply_price, retail_sales_enabled, retail_price, markup_percentage,
        tax_type, custom_tax_rate, team_commission_enabled, team_commission_rate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [
                data.name, data.barcode ?? null, data.brand_id ?? null, data.category_id ?? null,
                data.measure_unit ?? "ml", data.amount ?? 0,
                data.short_description ?? null, data.description ?? null,
                data.supply_price ?? 0, data.retail_sales_enabled ?? true,
                data.retail_price ?? null, data.markup_percentage ?? null,
                data.tax_type ?? "no_tax", data.custom_tax_rate ?? null,
                data.team_commission_enabled ?? false, data.team_commission_rate ?? null,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateProductBody): Promise<Product> {
        const keys = Object.keys(patch) as (keyof UpdateProductBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
            return rows[0];
        }
        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${String(k)} = $${i + 1}`); values.push((patch as any)[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        const { rows } = await pool.query(
            `UPDATE products SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`, values
        );
        return rows[0];
    },

    async delete(id: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM products WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
    },
};

// ─── Product Photos Repository ────────────────────────────────────────────────

export const productPhotosRepository = {
    async findByProductId(productId: string): Promise<ProductPhoto[]> {
        const { rows } = await pool.query(
            `SELECT * FROM product_photos WHERE product_id = $1 ORDER BY sort_order ASC`, [productId]
        );
        return rows;
    },

    async findById(id: string): Promise<ProductPhoto | null> {
        const { rows } = await pool.query(`SELECT * FROM product_photos WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async insertMany(
        productId: string,
        files: { url: string; filename: string }[],
        startOrder: number
    ): Promise<ProductPhoto[]> {
        if (files.length === 0) return [];
        const valueClauses = files
            .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
            .join(", ");
        const values = files.flatMap((f, i) => [productId, f.url, f.filename, startOrder + i]);
        const { rows } = await pool.query(
            `INSERT INTO product_photos (product_id, url, filename, sort_order) VALUES ${valueClauses} RETURNING *`,
            values
        );
        return rows;
    },

    async reorder(updates: { id: string; sort_order: number }[]): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const u of updates) {
                await client.query(
                    `UPDATE product_photos SET sort_order = $1 WHERE id = $2`, [u.sort_order, u.id]
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

    async delete(id: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM product_photos WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
    },

    async getMaxSortOrder(productId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM product_photos WHERE product_id = $1`,
            [productId]
        );
        return parseInt(rows[0].max_order, 10);
    },
};

// ─── Brands Repository ────────────────────────────────────────────────────────

export const brandsRepository = {
    async findById(id: string): Promise<Brand | null> {
        const { rows } = await pool.query(`SELECT * FROM product_brands WHERE id = $1`, [id]);
        return rows[0] || null;
    },

    async findByName(name: string): Promise<Brand | null> {
        const { rows } = await pool.query(
            `SELECT * FROM product_brands WHERE LOWER(name) = LOWER($1)`, [name]
        );
        return rows[0] || null;
    },

    async list(): Promise<Brand[]> {
        const { rows } = await pool.query(`SELECT * FROM product_brands ORDER BY name ASC`);
        return rows;
    },

    async create(data: CreateBrandBody): Promise<Brand> {
        const { rows } = await pool.query(
            `INSERT INTO product_brands (name) VALUES ($1) RETURNING *`, [data.name.trim()]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateBrandBody): Promise<Brand> {
        const keys = Object.keys(patch) as (keyof UpdateBrandBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM product_brands WHERE id = $1`, [id]);
            return rows[0];
        }
        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${String(k)} = $${i + 1}`); values.push((patch as any)[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        const { rows } = await pool.query(
            `UPDATE product_brands SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`, values
        );
        return rows[0];
    },

    async delete(id: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM product_brands WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
    },
};
