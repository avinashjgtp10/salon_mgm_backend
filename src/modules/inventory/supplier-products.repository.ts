import pool from "../../config/database";
import {
    SupplierProduct, ListSupplierProductsFilters, ResolveAction,
} from "./supplier-products.types";

// Schema (supplier_products) is NOT self-migrated from here — per project
// policy, schema changes are never auto-run. See
// Migration/create_supplier_products.sql; run it by hand against each
// environment before using this module.

const SELECT = `
  SELECT sp.*,
         p.name AS linked_product_name,
         pb.name AS brand_name,
         sc.name AS category_name
    FROM supplier_products sp
    LEFT JOIN products p ON p.id = sp.product_id
    LEFT JOIN product_brands pb ON pb.id = sp.brand_id
    LEFT JOIN service_categories sc ON sc.id = sp.category_id`;

export const supplierProductsRepository = {
    async list(supplierId: string, salonId: string, filters: ListSupplierProductsFilters = {}): Promise<SupplierProduct[]> {
        const conditions = [`sp.supplier_id = $1`, `sp.salon_id = $2`];
        const values: unknown[] = [supplierId, salonId];

        if (filters.matched_only) {
            conditions.push(`sp.match_status = 'matched'`, `sp.ignored = false`);
        }

        const { rows } = await pool.query(
            `${SELECT} WHERE ${conditions.join(" AND ")} ORDER BY sp.name ASC`,
            values,
        );
        return rows;
    },

    async getById(id: string, salonId: string): Promise<SupplierProduct | null> {
        const { rows } = await pool.query(`${SELECT} WHERE sp.id = $1 AND sp.salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },

    // Stage-1 dedupe source — every existing catalog row for this supplier,
    // prefetched once so a re-import matches in memory rather than one
    // SELECT per row (same reasoning as products.import.ts's prefetch).
    async listMinimalForDedupe(supplierId: string, salonId: string): Promise<
        { id: string; barcode: string | null; supplier_sku: string | null; name: string; brand_id: string | null; category_id: string | null; product_id: string | null }[]
    > {
        const { rows } = await pool.query(
            `SELECT id, barcode, supplier_sku, name, brand_id, category_id, product_id
               FROM supplier_products WHERE supplier_id = $1 AND salon_id = $2`,
            [supplierId, salonId],
        );
        return rows;
    },

    async insert(data: {
        salonId: string; supplierId: string; productId: string | null; name: string; barcode: string | null;
        brandId: string | null; categoryId: string | null; supplierSku: string | null; price: number | null;
        hsnSac: string | null; matchStatus: "matched" | "unmatched";
    }): Promise<{ id: string; barcode: string | null; name: string; brand_id: string | null; category_id: string | null }> {
        const { rows } = await pool.query(
            `INSERT INTO supplier_products
               (salon_id, supplier_id, product_id, name, barcode, brand_id, category_id, supplier_sku, price, hsn_sac, match_status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id, barcode, name, brand_id, category_id`,
            [
                data.salonId, data.supplierId, data.productId, data.name, data.barcode,
                data.brandId, data.categoryId, data.supplierSku, data.price, data.hsnSac, data.matchStatus,
            ],
        );
        return rows[0];
    },

    // Stage-1 match on re-import — refreshes price/hsn/name in place.
    // product_id is DELIBERATELY never touched here: preserves whatever
    // link/create_product resolution already happened on a prior import,
    // per the "keep the existing SalonOX product mapping" rule.
    async updateFromReimport(id: string, data: {
        name: string; barcode: string | null; brandId: string | null; categoryId: string | null;
        price: number | null; hsnSac: string | null;
    }): Promise<void> {
        await pool.query(
            `UPDATE supplier_products
                SET name = $1, barcode = $2, brand_id = $3, category_id = $4, price = $5, hsn_sac = $6, updated_at = NOW()
              WHERE id = $7`,
            [data.name, data.barcode, data.brandId, data.categoryId, data.price, data.hsnSac, id],
        );
    },

    async resolve(id: string, salonId: string, action: ResolveAction, productId: string | null): Promise<SupplierProduct | null> {
        if (action === "ignore") {
            await pool.query(
                `UPDATE supplier_products SET ignored = true, updated_at = NOW() WHERE id = $1 AND salon_id = $2`,
                [id, salonId],
            );
        } else {
            // link (caller-chosen product_id) and create_product (a freshly
            // created product's id, passed in by the service) both just set
            // product_id + flip match_status — the two actions only differ
            // in WHERE the product_id came from, handled by the service layer.
            await pool.query(
                `UPDATE supplier_products SET product_id = $1, match_status = 'matched', updated_at = NOW() WHERE id = $2 AND salon_id = $3`,
                [productId, id, salonId],
            );
        }
        return this.getById(id, salonId);
    },
};
