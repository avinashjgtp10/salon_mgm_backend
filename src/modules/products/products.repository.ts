import pool from "../../config/database";
import {
    Product, CreateProductBody, UpdateProductBody, ProductListFilters,
    ProductPhoto, Brand, CreateBrandBody, UpdateBrandBody,
} from "./products.types";

const PRODUCT_COLUMNS = `id, name, barcode, brand_id, category_id, supplier_id, measure_unit, product_type, size, amount, bottle_size, qty_alert,
    short_description, description, remark, lot_number, supply_price, retail_sales_enabled,
    retail_price, markup_percentage, tax_type, custom_tax_rate, tax_group, hsn_sac,
    team_commission_enabled, team_commission_rate, expiry_date, is_active, is_public, created_at, updated_at`;

const PRODUCT_COLUMNS_P = `p.id, p.name, p.barcode, p.brand_id, p.category_id, p.supplier_id, p.measure_unit, p.product_type, p.size, p.amount, p.bottle_size, p.qty_alert,
    p.short_description, p.description, p.remark, p.lot_number, p.supply_price, p.retail_sales_enabled,
    p.retail_price, p.markup_percentage, p.tax_type, p.custom_tax_rate, p.tax_group, p.hsn_sac,
    p.team_commission_enabled, p.team_commission_rate, p.expiry_date, p.is_active, p.is_public, p.created_at, p.updated_at`;

// ─── Products Repository ──────────────────────────────────────────────────────

export const productsRepository = {
    async findById(id: string, salonId: string): Promise<Product | null> {
        const { rows } = await pool.query(
            `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async findByBarcode(barcode: string, salonId: string, excludeId?: string): Promise<Product | null> {
        const values: unknown[] = [barcode, salonId];
        let sql = `SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = $1 AND salon_id = $2`;
        if (excludeId) {
            values.push(excludeId);
            sql += ` AND id != $${values.length}`;
        }
        const { rows } = await pool.query(sql, values);
        return rows[0] || null;
    },

    // Duplicate-guard for the name+brand+category combination — `IS NOT DISTINCT
    // FROM` so two products that both have no brand/category still count as the
    // same combination (a plain `=` would silently let NULL = NULL pass).
    async findByNameBrandCategory(
        name: string,
        brandId: string | null | undefined,
        categoryId: string | null | undefined,
        salonId: string,
        excludeId?: string
    ): Promise<Product | null> {
        const values: unknown[] = [name.trim(), brandId ?? null, categoryId ?? null, salonId];
        let sql = `SELECT ${PRODUCT_COLUMNS} FROM products
            WHERE LOWER(name) = LOWER($1)
            AND brand_id IS NOT DISTINCT FROM $2
            AND category_id IS NOT DISTINCT FROM $3
            AND salon_id = $4`;
        if (excludeId) {
            values.push(excludeId);
            sql += ` AND id != $${values.length}`;
        }
        const { rows } = await pool.query(sql, values);
        return rows[0] || null;
    },

    // Bulk import needs to duplicate-check every row against every existing
    // product (by barcode, and by name+brand+category) — doing that as two
    // SELECTs per row means an N-row file fires ~2N sequential round-trips
    // before it even starts creating anything, which is slow enough on a
    // large file to trip an upstream proxy/gateway timeout well before the
    // request actually finishes. Fetching just the columns duplicate-checks
    // need, once, lets the import build its own in-memory lookup instead.
    async listMinimalForImport(salonId: string): Promise<Array<{ id: string; barcode: string | null; name: string; brand_id: string | null; category_id: string | null }>> {
        const { rows } = await pool.query(
            `SELECT id, barcode, name, brand_id, category_id FROM products WHERE salon_id = $1`,
            [salonId]
        );
        return rows;
    },

    // `prefix` is the column-qualifier to use (e.g. "p." when querying the aliased
    // `products p` join used by listExport, "" for the unaliased table in `list`).
    _buildFilterConditions(filters: ProductListFilters, salonId: string, prefix = ""): { where: string; values: unknown[] } {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        // Always scope to salon first
        conditions.push(`${prefix}salon_id = $${idx++}`);
        values.push(salonId);

        if (filters.search) {
            conditions.push(
                `(${prefix}name ILIKE $${idx} OR ${prefix}barcode ILIKE $${idx} OR EXISTS (
                    SELECT 1 FROM suppliers sup_search
                    WHERE sup_search.id = ${prefix}supplier_id AND sup_search.name ILIKE $${idx}
                ))`
            );
            values.push(`%${filters.search}%`);
            idx++;
        }
        if (filters.category_id) {
            conditions.push(`${prefix}category_id = $${idx++}`);
            values.push(filters.category_id);
        }
        if (filters.brand_id) {
            conditions.push(`${prefix}brand_id = $${idx++}`);
            values.push(filters.brand_id);
        }
        if (filters.product_type) {
            conditions.push(`${prefix}product_type = $${idx++}`);
            values.push(filters.product_type);
        }
        if (filters.retail_sales_enabled !== undefined) {
            conditions.push(`${prefix}retail_sales_enabled = $${idx++}`);
            values.push(filters.retail_sales_enabled);
        }
        if (filters.min_price !== undefined) {
            conditions.push(`${prefix}supply_price >= $${idx++}`);
            values.push(filters.min_price);
        }
        if (filters.max_price !== undefined) {
            conditions.push(`${prefix}supply_price <= $${idx++}`);
            values.push(filters.max_price);
        }
        if (filters.stock !== undefined && filters.stock !== "all") {
            if (filters.stock === "low") {
                // qty_alert is a PACKAGE count ("Low Stock Alert (in bottles/
                // units)") while amount is base units, so a consumable has to
                // be compared as bottles or this filter never matches it —
                // same CEIL the Consumable Inventory page uses.
                conditions.push(`(${prefix}amount > 0 AND (
                    CASE WHEN ${prefix}bottle_size IS NOT NULL AND ${prefix}bottle_size > 0
                         THEN CEIL(COALESCE(${prefix}amount, 0) / ${prefix}bottle_size)
                         ELSE COALESCE(${prefix}amount, 0)
                    END) <= ${prefix}qty_alert)`);
            } else if (filters.stock === "out_of_stock") {
                conditions.push(`${prefix}amount = 0`);
            }
        }
        // Deactivated products are hidden by default everywhere this filter is
        // used (Products list, exports) — pass is_active: false explicitly to
        // see them (no caller does yet, but the option exists for later).
        conditions.push(`${prefix}is_active = $${idx++}`);
        values.push(filters.is_active ?? true);

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        return { where, values };
    },

    async list(filters: ProductListFilters, salonId: string): Promise<{ data: Product[]; total: number }> {
        const { where, values } = productsRepository._buildFilterConditions(filters, salonId);

        const allowedSorts: Record<string, string> = {
            name: "name", created_at: "created_at",
            supply_price: "supply_price", retail_price: "retail_price",
        };
        const orderCol = allowedSorts[filters.sort_by ?? "created_at"] ?? "created_at";
        const orderDir = filters.sort_order === "ASC" ? "ASC" : "DESC";

        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const offset = (page - 1) * limit;

        const dataIdx = values.length + 1;
        const [{ rows: countRows }, { rows }] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total FROM products ${where}`, values),
            pool.query(
                `SELECT ${PRODUCT_COLUMNS} FROM products ${where} ORDER BY ${orderCol} ${orderDir} LIMIT $${dataIdx} OFFSET $${dataIdx + 1}`,
                [...values, limit, offset]
            ),
        ]);
        const total = parseInt(countRows[0].total, 10);

        return { data: rows, total };
    },

    // Same filtering as `list`, but returns every matching row (no pagination) with the
    // brand name joined in, for use by the export endpoints so exports mirror the table.
    async listExport(filters: ProductListFilters, salonId: string): Promise<Product[]> {
        const { where, values } = productsRepository._buildFilterConditions(filters, salonId, "p.");

        const allowedSorts: Record<string, string> = {
            name: "name", created_at: "created_at",
            supply_price: "supply_price", retail_price: "retail_price",
        };
        const orderCol = allowedSorts[filters.sort_by ?? "created_at"] ?? "created_at";
        const orderDir = filters.sort_order === "ASC" ? "ASC" : "DESC";

        const { rows } = await pool.query(
            `SELECT ${PRODUCT_COLUMNS_P}, pb.name as brand_name, sc.name as category_name, sup.name as supplier_name
             FROM products p
             LEFT JOIN product_brands pb ON p.brand_id = pb.id
             LEFT JOIN service_categories sc ON p.category_id = sc.id
             LEFT JOIN suppliers sup ON p.supplier_id = sup.id
             ${where}
             ORDER BY p.${orderCol} ${orderDir}`,
            values
        );
        return rows;
    },

    async create(data: CreateProductBody, salonId: string): Promise<Product> {
        const { rows } = await pool.query(
            `INSERT INTO products (
        salon_id,
        name, barcode, brand_id, category_id, supplier_id, measure_unit, product_type, size, amount, bottle_size, qty_alert,
        short_description, description, remark, lot_number,
        supply_price, retail_sales_enabled, retail_price, markup_percentage,
        tax_type, custom_tax_rate, tax_group, hsn_sac, team_commission_enabled, team_commission_rate, expiry_date, is_public
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING ${PRODUCT_COLUMNS}`,
            [
                salonId,
                data.name, data.barcode ?? null, data.brand_id ?? null, data.category_id ?? null, data.supplier_id ?? null,
                data.measure_unit ?? "ml", data.product_type ?? "retail", data.size ?? null, data.amount ?? 0, data.bottle_size ?? null, data.qty_alert ?? null,
                data.short_description ?? null, data.description ?? null, data.remark ?? null, data.lot_number ?? null,
                data.supply_price ?? 0, data.retail_sales_enabled ?? true,
                data.retail_price ?? null, data.markup_percentage ?? null,
                data.tax_type ?? "no_tax", data.custom_tax_rate ?? null, data.tax_group ?? null, data.hsn_sac ?? null,
                data.team_commission_enabled ?? false, data.team_commission_rate ?? null, data.expiry_date ?? null,
                data.is_public ?? true,
            ]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateProductBody, salonId: string): Promise<Product> {
        const keys = Object.keys(patch) as (keyof UpdateProductBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(
                `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND salon_id = $2`, [id, salonId]
            );
            return rows[0];
        }
        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${String(k)} = $${i + 1}`); values.push((patch as any)[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        values.push(salonId);
        const { rows } = await pool.query(
            `UPDATE products SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING ${PRODUCT_COLUMNS}`,
            values
        );
        return rows[0];
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM products WHERE id = $1 AND salon_id = $2`, [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },

    async deductStock(items: { product_id: string; quantity: number }[], salonId: string): Promise<void> {
        if (items.length === 0) return;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const { product_id, quantity } of items) {
                await client.query(
                    `UPDATE products
                     SET amount = GREATEST(amount - $1, 0), updated_at = NOW()
                     WHERE id = $2 AND salon_id = $3`,
                    [quantity, product_id, salonId]
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

    async restoreStock(items: { product_id: string; quantity: number }[], salonId: string): Promise<void> {
        if (items.length === 0) return;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const { product_id, quantity } of items) {
                await client.query(
                    `UPDATE products
                     SET amount = amount + $1, updated_at = NOW()
                     WHERE id = $2 AND salon_id = $3`,
                    [quantity, product_id, salonId]
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
                await client.query(`UPDATE product_photos SET sort_order = $1 WHERE id = $2`, [u.sort_order, u.id]);
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
    async findById(id: string, salonId: string): Promise<Brand | null> {
        const { rows } = await pool.query(
            `SELECT * FROM product_brands WHERE id = $1 AND salon_id = $2`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async findByName(name: string, salonId: string): Promise<Brand | null> {
        const { rows } = await pool.query(
            `SELECT * FROM product_brands WHERE LOWER(name) = LOWER($1) AND salon_id = $2`,
            [name, salonId]
        );
        return rows[0] || null;
    },

    async list(salonId: string): Promise<Brand[]> {
        const { rows } = await pool.query(
            `SELECT * FROM product_brands WHERE salon_id = $1 ORDER BY name ASC`,
            [salonId]
        );
        return rows;
    },

    async create(data: CreateBrandBody, salonId: string): Promise<Brand> {
        const { rows } = await pool.query(
            `INSERT INTO product_brands (salon_id, name) VALUES ($1, $2) RETURNING *`,
            [salonId, data.name.trim()]
        );
        return rows[0];
    },

    async update(id: string, patch: UpdateBrandBody, salonId: string): Promise<Brand> {
        const keys = Object.keys(patch) as (keyof UpdateBrandBody)[];
        if (keys.length === 0) {
            const { rows } = await pool.query(
                `SELECT * FROM product_brands WHERE id = $1 AND salon_id = $2`, [id, salonId]
            );
            return rows[0];
        }
        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k, i) => { setParts.push(`${String(k)} = $${i + 1}`); values.push((patch as any)[k]); });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        values.push(salonId);
        const { rows } = await pool.query(
            `UPDATE product_brands SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING *`,
            values
        );
        return rows[0];
    },

    async delete(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM product_brands WHERE id = $1 AND salon_id = $2`, [id, salonId]
        );
        return (rowCount ?? 0) > 0;
    },
};
