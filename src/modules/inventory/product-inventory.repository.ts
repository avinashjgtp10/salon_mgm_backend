import pool from "../../config/database";

/**
 * Product Inventory — stock management for RETAIL products.
 *
 * Deliberately separate from consumable-inventory.repository.ts: consumables
 * are stock the salon burns during a service (tracked per-service via recipes),
 * retail products are stock the salon resells. They already have their own
 * page, so this one filters to product_type retail/both.
 *
 * Units: `products.amount` is the source of truth and is stored in BASE units
 * (ml/g), while staff count and reorder in whole bottles/packs — the same
 * convention qty_alert and the stocktake screens use. So a bottle count is
 * `amount / bottle_size` and a stock-in of N bottles adds `N * bottle_size`.
 * `products.current_stock` exists but is unpopulated across every row in the
 * database and is not read or written here.
 */

/** Whole bottles/packs from base units, as SQL — kept in one place so the list,
 *  the stock-in result and the low-stock flag can't drift apart. */
const STOCK_IN_PACKS = `
  CASE WHEN COALESCE(p.bottle_size, 0) > 0
       THEN COALESCE(p.amount, 0) / p.bottle_size
       ELSE COALESCE(p.amount, 0) END`;

// Retail-only scope. 'both' is included — those products are sold AND consumed,
// so they still need resale stock tracked here.
const RETAIL_SCOPE = `COALESCE(p.product_type, 'retail') IN ('retail', 'both')`;

export type ProductInventoryStatus = "in_stock" | "low_stock" | "out_of_stock" | "expired" | "expiring_soon";

export interface ProductInventoryRow {
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    category: string | null;
    category_id: string | null;
    supplier: string | null;
    supplier_id: string | null;
    measure_unit: string | null;
    bottle_size: number | null;
    /** Whole bottles/packs currently in stock ("Available"). */
    stock: number;
    /** Raw base units, for callers that need the underlying figure. */
    amount: number;
    qty_alert: number | null;
    low_stock: boolean;
    retail_price: number | null;
    supply_price: number | null;
    /** Lifetime totals, in whole bottles/packs — see the aggregate joins in
     *  buildProductInventoryQuery(). */
    purchased: number;
    sold: number;
    consumed: number;
    /** Soonest not-yet-expired purchase batch date, falling back to the
     *  product's own manual expiry_date when it has no purchase history. */
    expiry_date: string | null;
    status: ProductInventoryStatus;
    last_updated: string | null;
}

export interface ListProductInventoryFilters {
    search?: string;
    /** service_categories.id — see the join note in list(). */
    category_id?: string;
    /** product_brands.id. */
    brand_id?: string;
    /** "low" restricts to items at or below their reorder point. */
    stock_status?: "all" | "low";
    page?: number;
    limit?: number;
}

// Category/brand are resolved through the id columns, NOT products.category /
// products.brand. Those text columns look like the obvious choice but are
// empty on every one of the 10,422 product rows in the database, whereas
// category_id is set on 10,275 and brand_id on 10,334 — filtering or grouping
// on the text would silently match nothing. category_id points at
// service_categories (shared with services), brand_id at product_brands.
// (product_brands is still used for the Brand *filter* dropdown in
// filterOptions() below, even though Brand is no longer a rendered column —
// see the 12-column Product Inventory table redesign.)
const CATEGORY_BRAND_JOIN = `
  LEFT JOIN service_categories sc ON sc.id = p.category_id
  LEFT JOIN product_brands     pb ON pb.id = p.brand_id`;

// Everything from FROM products p through the last LEFT JOIN, shared between
// list() (paginated/filtered) and getRowsByProductIds() (scoped to specific
// ids, used to build the "updatedProducts" payload a purchase's save response
// returns) — one aggregation query, not two copies that could drift apart.
function buildProductInventoryQuery(whereClause: string): string {
    return `
    SELECT p.id, p.name, p.sku, p.barcode,
           sc.name AS category,
           sup.name AS supplier,
           p.category_id, p.supplier_id,
           p.measure_unit, p.bottle_size,
           COALESCE(p.amount, 0)::float8               AS amount,
           (${STOCK_IN_PACKS})::float8                 AS stock,
           p.qty_alert,
           (p.qty_alert IS NOT NULL AND p.qty_alert > 0
              AND CEIL(${STOCK_IN_PACKS}) <= p.qty_alert) AS low_stock,
           p.retail_price::float8                      AS retail_price,
           p.supply_price::float8                      AS supply_price,
           COALESCE(purchased_agg.qty, 0)::float8       AS purchased,
           COALESCE(sold_agg.qty, 0)::float8            AS sold,
           COALESCE(consumed_agg.qty, 0)::float8        AS consumed,
           COALESCE(expiry_agg.soonest_upcoming_expiry, p.expiry_date) AS expiry_date,
           CASE
             WHEN COALESCE(p.amount, 0) = 0 THEN 'out_of_stock'
             WHEN COALESCE(expiry_agg.latest_expiry, p.expiry_date) < CURRENT_DATE THEN 'expired'
             WHEN (p.qty_alert IS NOT NULL AND p.qty_alert > 0
                     AND CEIL(${STOCK_IN_PACKS}) <= p.qty_alert) THEN 'low_stock'
             WHEN COALESCE(expiry_agg.soonest_upcoming_expiry, p.expiry_date) IS NOT NULL
                  AND COALESCE(expiry_agg.soonest_upcoming_expiry, p.expiry_date) <= CURRENT_DATE + INTERVAL '30 days'
               THEN 'expiring_soon'
             ELSE 'in_stock'
           END AS status,
           p.updated_at AS last_updated
      FROM products p
      LEFT JOIN service_categories sc ON sc.id = p.category_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN (
        SELECT sm.product_id, SUM(sm.quantity) AS qty
          FROM stock_movements sm
          JOIN products p2 ON p2.id = sm.product_id
         WHERE p2.salon_id = $1 AND sm.movement_type = 'in'
         GROUP BY sm.product_id
      ) purchased_agg ON purchased_agg.product_id = p.id
      LEFT JOIN (
        SELECT si.item_id AS product_id, SUM(si.quantity) AS qty
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product'
         GROUP BY si.item_id
      ) sold_agg ON sold_agg.product_id = p.id
      LEFT JOIN (
        SELECT cu.product_id,
               SUM(CASE WHEN cu.direction = 'return' THEN -cu.qty ELSE cu.qty END) AS qty
          FROM consumable_usage cu
         WHERE cu.salon_id = $1
         GROUP BY cu.product_id
      ) consumed_agg ON consumed_agg.product_id = p.id
      LEFT JOIN (
        SELECT pi.product_id,
               MIN(pi.expiry_date) FILTER (WHERE pi.expiry_date >= CURRENT_DATE) AS soonest_upcoming_expiry,
               MAX(pi.expiry_date) AS latest_expiry
          FROM purchase_items pi
          JOIN purchases pu ON pu.id = pi.purchase_id
         WHERE pu.salon_id = $1 AND pi.expiry_date IS NOT NULL
         GROUP BY pi.product_id
      ) expiry_agg ON expiry_agg.product_id = p.id
      ${whereClause}`;
}

export const productInventoryRepository = {
    async list(
        filters: ListProductInventoryFilters,
        salonId: string,
    ): Promise<{ data: ProductInventoryRow[]; total: number }> {
        const conditions: string[] = [`p.salon_id = $1`, RETAIL_SCOPE, `COALESCE(p.is_active, TRUE) = TRUE`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.search) {
            // Matches the three things staff actually search by on a shelf.
            conditions.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
            values.push(`%${filters.search}%`);
            idx++;
        }
        if (filters.category_id) { conditions.push(`p.category_id = $${idx++}`); values.push(filters.category_id); }
        if (filters.brand_id) { conditions.push(`p.brand_id = $${idx++}`); values.push(filters.brand_id); }
        if (filters.stock_status === "low") {
            conditions.push(`(p.qty_alert IS NOT NULL AND p.qty_alert > 0 AND CEIL(${STOCK_IN_PACKS}) <= p.qty_alert)`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM products p ${where}`,
            values,
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `${buildProductInventoryQuery(where)}
              ORDER BY p.name ASC
              LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset],
        );

        return { data: rows, total };
    },

    /** Fully-recomputed rows for exactly these product ids — used to build the
     *  "updatedProducts" a purchase's save response returns, so the frontend
     *  can patch its table in place without a second GET after saving. */
    async getRowsByProductIds(productIds: string[], salonId: string): Promise<ProductInventoryRow[]> {
        if (!productIds.length) return [];
        // Same scope as list() (retail/both, active) — a purchased product that
        // isn't actually a Product Inventory item (e.g. consumable-only) has
        // nothing to patch into this table, so it's correctly left out here.
        const { rows } = await pool.query(
            buildProductInventoryQuery(
                `WHERE p.id = ANY($2) AND p.salon_id = $1 AND ${RETAIL_SCOPE} AND COALESCE(p.is_active, TRUE) = TRUE`,
            ),
            [salonId, productIds],
        );
        return rows;
    },

    /** Categories/brands that actually have a product in scope — so the filter
     *  dropdowns can never offer a value that matches nothing. */
    async filterOptions(
        salonId: string,
    ): Promise<{ categories: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string }> }> {
        const [cats, brands] = await Promise.all([
            pool.query(
                `SELECT DISTINCT sc.id, sc.name
                   FROM products p
                   JOIN service_categories sc ON sc.id = p.category_id
                  WHERE p.salon_id = $1 AND ${RETAIL_SCOPE} AND COALESCE(p.is_active, TRUE) = TRUE
                  ORDER BY sc.name`,
                [salonId],
            ),
            pool.query(
                `SELECT DISTINCT pb.id, pb.name
                   FROM products p
                   JOIN product_brands pb ON pb.id = p.brand_id
                  WHERE p.salon_id = $1 AND ${RETAIL_SCOPE} AND COALESCE(p.is_active, TRUE) = TRUE
                  ORDER BY pb.name`,
                [salonId],
            ),
        ]);
        return { categories: cats.rows, brands: brands.rows };
    },

    /**
     * Add stock to a product and record it.
     *
     * `quantity` is in whole bottles/packs (see the units note at the top).
     * Runs in a transaction with a row lock: the read of the current amount and
     * the write of the new one must not interleave with another stock-in or a
     * sale's stock deduction, or one of the two updates would be computed from
     * a stale figure and silently lost.
     */
    async stockIn(params: {
        productId: string;
        salonId: string;
        quantity: number;
        notes?: string | null;
        supplierId?: string | null;
        unitPrice?: number | null;
        createdBy: string;
    }): Promise<{ before: number; after: number; movementId: string }> {
        if (!(params.quantity > 0)) {
            throw new Error("Quantity must be greater than zero");
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            const { rows: prodRows } = await client.query(
                `SELECT id, COALESCE(amount, 0)::float8 AS amount, bottle_size
                   FROM products
                  WHERE id = $1 AND salon_id = $2
                  FOR UPDATE`,
                [params.productId, params.salonId],
            );
            if (!prodRows.length) throw new Error("Product not found in this salon");

            const bottleSize = Number(prodRows[0].bottle_size) || 0;
            const baseUnitsPerPack = bottleSize > 0 ? bottleSize : 1;
            const beforeBase = Number(prodRows[0].amount) || 0;
            const addedBase = params.quantity * baseUnitsPerPack;
            const afterBase = beforeBase + addedBase;

            await client.query(
                `UPDATE products SET amount = $1, updated_at = NOW()
                  WHERE id = $2 AND salon_id = $3`,
                [afterBase, params.productId, params.salonId],
            );

            // before/after are stored in PACKS, matching what the history screen
            // shows and what staff typed — storing base units here would make
            // the audit trail read in different units than the input that
            // produced it.
            const { rows: mvRows } = await client.query(
                `INSERT INTO stock_movements
                   (product_id, movement_type, quantity, unit_price, total_amount,
                    supplier_id, notes, created_by, before_stock, after_stock)
                 VALUES ($1, 'in', $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`,
                [
                    params.productId,
                    params.quantity,
                    params.unitPrice ?? null,
                    params.unitPrice != null ? params.unitPrice * params.quantity : null,
                    params.supplierId ?? null,
                    params.notes ?? null,
                    params.createdBy,
                    beforeBase / baseUnitsPerPack,
                    afterBase / baseUnitsPerPack,
                ],
            );

            await client.query("COMMIT");
            return {
                before: beforeBase / baseUnitsPerPack,
                after: afterBase / baseUnitsPerPack,
                movementId: mvRows[0].id,
            };
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    },

    /**
     * Stock-addition history. Joins the product name and the user who did it —
     * stockMovementsRepository.list() returns bare `sm.*`, which would render
     * as raw uuids on screen.
     */
    async history(
        filters: { productId?: string; page?: number; limit?: number },
        salonId: string,
    ): Promise<{ data: any[]; total: number }> {
        const conditions: string[] = [`p.salon_id = $1`, `sm.movement_type = 'in'`];
        const values: unknown[] = [salonId];
        let idx = 2;

        if (filters.productId) { conditions.push(`sm.product_id = $${idx++}`); values.push(filters.productId); }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const page = Math.max(1, filters.page ?? 1);
        const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM stock_movements sm
               JOIN products p ON p.id = sm.product_id ${where}`,
            values,
        );
        const total = parseInt(countRows[0].count, 10);

        const { rows } = await pool.query(
            `SELECT sm.id, sm.product_id, sm.quantity::float8 AS quantity,
                    sm.before_stock::float8 AS before_stock,
                    sm.after_stock::float8  AS after_stock,
                    sm.unit_price::float8   AS unit_price,
                    sm.total_amount::float8 AS total_amount,
                    sm.notes, sm.created_at,
                    p.name AS product_name, p.sku,
                    sc.name AS category, pb.name AS brand,
                    NULLIF(TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))), '') AS created_by_name
               FROM stock_movements sm
               JOIN products p ON p.id = sm.product_id
               ${CATEGORY_BRAND_JOIN}
               LEFT JOIN users u ON u.id = sm.created_by
               ${where}
              ORDER BY sm.created_at DESC
              LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset],
        );

        return { data: rows, total };
    },
};
