import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { ProductSupplier, AddProductSupplierBody, UpdateProductSupplierBody } from "./product-suppliers.types";

// Schema (product_suppliers) is NOT self-migrated from here — per project
// policy, schema changes are never auto-run. See
// Migration/create_product_suppliers.sql; run it by hand against each
// environment before using this module.

const SELECT = `
  SELECT ps.*, sup.name AS supplier_name
    FROM product_suppliers ps
    JOIN suppliers sup ON sup.id = ps.supplier_id`;

export const productSuppliersRepository = {
    async list(productId: string, salonId: string): Promise<ProductSupplier[]> {
        const { rows } = await pool.query(
            `${SELECT} WHERE ps.product_id = $1 AND ps.salon_id = $2
             ORDER BY ps.is_preferred DESC, sup.name ASC`,
            [productId, salonId],
        );
        return rows;
    },

    async getById(id: string, salonId: string): Promise<ProductSupplier | null> {
        const { rows } = await pool.query(`${SELECT} WHERE ps.id = $1 AND ps.salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },

    // Setting is_preferred=true on a new/edited row unsets it on every other
    // supplier mapping for the same product, in the same transaction — only
    // one preferred supplier per product at a time.
    async add(productId: string, salonId: string, body: AddProductSupplierBody): Promise<ProductSupplier> {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            if (body.is_preferred) {
                await client.query(
                    `UPDATE product_suppliers SET is_preferred = false WHERE product_id = $1 AND salon_id = $2`,
                    [productId, salonId],
                );
            }
            const { rows } = await client.query(
                `INSERT INTO product_suppliers (salon_id, product_id, supplier_id, supplier_sku, price, is_preferred)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (product_id, supplier_id)
                 DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku, price = EXCLUDED.price,
                               is_preferred = EXCLUDED.is_preferred, updated_at = NOW()
                 RETURNING id`,
                [salonId, productId, body.supplier_id, body.supplier_sku ?? null, body.price ?? null, body.is_preferred ?? false],
            );
            await client.query("COMMIT");
            return (await this.getById(rows[0].id, salonId))!;
        } catch (err: any) {
            await client.query("ROLLBACK");
            if (err?.code === "23503") throw new AppError(404, "supplier_id not found in this salon", "SUPPLIER_NOT_FOUND");
            throw err;
        } finally {
            client.release();
        }
    },

    async update(id: string, salonId: string, patch: UpdateProductSupplierBody): Promise<ProductSupplier> {
        const existing = await this.getById(id, salonId);
        if (!existing) throw new AppError(404, "Product-supplier mapping not found", "PRODUCT_SUPPLIER_NOT_FOUND");

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            if (patch.is_preferred) {
                await client.query(
                    `UPDATE product_suppliers SET is_preferred = false WHERE product_id = $1 AND salon_id = $2 AND id != $3`,
                    [existing.product_id, salonId, id],
                );
            }
            await client.query(
                `UPDATE product_suppliers
                    SET supplier_sku = COALESCE($1, supplier_sku),
                        price = COALESCE($2, price),
                        is_preferred = COALESCE($3, is_preferred),
                        updated_at = NOW()
                  WHERE id = $4 AND salon_id = $5`,
                [patch.supplier_sku ?? null, patch.price ?? null, patch.is_preferred ?? null, id, salonId],
            );
            await client.query("COMMIT");
            return (await this.getById(id, salonId))!;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    async remove(id: string, salonId: string): Promise<void> {
        await pool.query(`DELETE FROM product_suppliers WHERE id = $1 AND salon_id = $2`, [id, salonId]);
    },
};
