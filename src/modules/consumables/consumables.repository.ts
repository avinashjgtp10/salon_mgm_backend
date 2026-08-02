import pool from "../../config/database";
import { ConsumableUsageItem, ConsumableUsageRequest, ConsumableUsageResponse } from "./consumables.types";

const SORT_COLUMNS = {
  product_name: "product_name",
  current_stock: "current_stock",
  configured_qty: "configured_qty",
  actual_used: "actual_used",
  remaining_stock: "remaining_stock",
  category: "category_name",
} as const;

// ─── Container-based stock (single source of truth) ───────────────────────────
// `p.amount` already holds the remaining quantity in the product's own unit
// (ml, g, ...) — that hasn't changed. Stock QUANTITY (bottle/container count)
// is derived from it rather than stored: a product with no bottle_size
// configured falls back to the raw amount, exactly like before this feature
// (backward compatible for every product that never sets a container size).
// Defined once here and referenced everywhere a bottle-aware figure is
// needed (SELECT list and WHERE filters both need their own textual copy —
// column aliases from the SELECT list aren't visible to the WHERE of the same
// query — but this string is the one place the formula itself is written).
const STOCK_QTY_EXPR = `CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
    THEN CEIL(COALESCE(p.amount, 0) / p.bottle_size)
    ELSE COALESCE(p.amount, 0) END`;
const STOCK_STATUS_EXPR = `CASE WHEN ${STOCK_QTY_EXPR} <= 0 THEN 'out_of_stock'
    WHEN ${STOCK_QTY_EXPR} <= COALESCE(p.qty_alert, 0) THEN 'low_stock'
    ELSE 'healthy' END`;

function buildQuery(request: ConsumableUsageRequest) {
  const values: unknown[] = [request.salon_id];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const filters = request.filters ?? {};
  const productWhere = ["p.salon_id = $1", "p.product_type IN ('consumable', 'both')", "p.is_active = true"];

  if (request.search) {
    const p = param(`%${request.search}%`);
    productWhere.push(`(p.name ILIKE ${p} OR p.sku ILIKE ${p} OR p.barcode ILIKE ${p})`);
  }
  if (filters.category_id) productWhere.push(`p.category_id = ${param(filters.category_id)}`);
  if (filters.unit) productWhere.push(`LOWER(p.measure_unit) = LOWER(${param(filters.unit)})`);
  // Low stock is evaluated against bottle/container count (STOCK_QTY_EXPR),
  // not raw remaining volume — see the constant's own comment.
  if (filters.stock_status === "out_of_stock") productWhere.push(`(${STOCK_QTY_EXPR}) <= 0`);
  if (filters.stock_status === "low_stock") productWhere.push(`(${STOCK_QTY_EXPR}) > 0 AND (${STOCK_QTY_EXPR}) <= COALESCE(p.qty_alert, 0)`);
  if (filters.stock_status === "healthy") productWhere.push(`(${STOCK_QTY_EXPR}) > COALESCE(p.qty_alert, 0)`);
  if (filters.service_id) {
    const p = param(filters.service_id);
    productWhere.push(`EXISTS (
      SELECT 1 FROM services sf CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sf.consumables, '[]'::jsonb)) configured
      WHERE sf.id = ${p} AND sf.salon_id = $1 AND configured->>'product_id' = p.id::text
    )`);
  }

  const configuredService = filters.service_id ? `AND s.id = ${param(filters.service_id)}` : "";
  const actualWhere = ["a.salon_id = $1", "a.status = 'paid'", "a.deleted_at IS NULL"];
  if (filters.date_from) actualWhere.push(`a.updated_at >= ${param(filters.date_from)}::date`);
  if (filters.date_to) actualWhere.push(`a.updated_at < (${param(filters.date_to)}::date + INTERVAL '1 day')`);
  if (filters.service_id) actualWhere.push(`actual->>'service_id' = ${param(filters.service_id)}::text`);

  const ctes = `
    WITH configured AS (
      SELECT configured->>'product_id' AS product_id,
             SUM(COALESCE((configured->>'standard_quantity')::numeric, 0)) AS configured_qty
      FROM services s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.consumables, '[]'::jsonb)) configured
      WHERE s.salon_id = $1 ${configuredService}
      GROUP BY configured->>'product_id'
    ), actual_rows AS (
      SELECT a.id AS appointment_id, actual->>'product_id' AS product_id,
             COALESCE((actual->>'actual_quantity')::numeric, 0) AS actual_quantity,
             a.updated_at AS used_at
      FROM appointments a CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.actual_consumables, '[]'::jsonb)) actual
      WHERE ${actualWhere.join(" AND ")}
    ), actual AS (
      SELECT product_id, SUM(actual_quantity) AS actual_used,
             COUNT(DISTINCT appointment_id)::int AS usage_count, MAX(used_at) AS last_used
      FROM actual_rows GROUP BY product_id
    ), products_base AS (
      SELECT p.id, p.name AS product_name, p.sku, p.barcode, c.name AS category_name,
             COALESCE(p.measure_unit, '') AS unit, COALESCE(p.amount, 0) AS current_stock,
             COALESCE(configured.configured_qty, 0) AS configured_qty,
             COALESCE(actual.actual_used, 0) AS actual_used,
             COALESCE(p.amount, 0) AS remaining_stock, actual.last_used,
             COALESCE(actual.usage_count, 0)::int AS usage_count,
             ${STOCK_STATUS_EXPR} AS stock_status,
             p.bottle_size AS bottle_size,
             (${STOCK_QTY_EXPR}) AS stock_quantity,
             CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
                  THEN (${STOCK_QTY_EXPR}) * p.bottle_size
                  ELSE NULL END AS total_available_volume
      FROM products p
      LEFT JOIN service_categories c ON c.id = p.category_id AND c.salon_id = p.salon_id
      LEFT JOIN configured ON configured.product_id = p.id::text
      LEFT JOIN actual ON actual.product_id = p.id::text
      WHERE ${productWhere.join(" AND ")}
    )`;
  return { ctes, values };
}

export const consumablesRepository = {
  async usage(request: ConsumableUsageRequest): Promise<ConsumableUsageResponse> {
    const { ctes, values } = buildQuery(request);
    const sort = request.sort ?? { field: "product_name" as const, direction: "asc" as const };
    const orderBy = SORT_COLUMNS[sort.field];
    const direction = sort.direction.toUpperCase();
    const page = request.page;
    const pageSize = request.pageSize;
    const offset = (page - 1) * pageSize;
    const pageValues = [...values, pageSize, offset];

    const [itemsResult, countResult, summaryResult] = await Promise.all([
      pool.query(`${ctes} SELECT * FROM products_base ORDER BY ${orderBy} ${direction} NULLS LAST, id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues),
      pool.query(`${ctes} SELECT COUNT(*)::int AS total FROM products_base`, values),
      pool.query(`${ctes}
        SELECT (SELECT COUNT(*)::int FROM products_base) AS total_consumable_products,
               COALESCE((SELECT SUM(ar.actual_quantity) FROM actual_rows ar JOIN products_base pb ON pb.id::text = ar.product_id
                         WHERE ar.used_at >= CURRENT_DATE AND ar.used_at < CURRENT_DATE + INTERVAL '1 day'), 0) AS today_consumption,
               (SELECT COUNT(*)::int FROM products_base WHERE stock_status IN ('low_stock', 'out_of_stock')) AS low_stock_products,
               (SELECT COUNT(DISTINCT ar.appointment_id)::int FROM actual_rows ar JOIN products_base pb ON pb.id::text = ar.product_id)
                 AS appointments_using_consumables`, values),
    ]);

    const number = (value: unknown) => Number(value ?? 0);
    const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
    const items: ConsumableUsageItem[] = itemsResult.rows.map((row) => ({
      ...row,
      current_stock: number(row.current_stock), configured_qty: number(row.configured_qty),
      actual_used: number(row.actual_used), remaining_stock: number(row.remaining_stock),
      usage_count: number(row.usage_count),
      bottle_size: nullableNumber(row.bottle_size),
      stock_quantity: number(row.stock_quantity),
      total_available_volume: nullableNumber(row.total_available_volume),
    }));
    const totalRecords = number(countResult.rows[0]?.total);
    const summary = summaryResult.rows[0] ?? {};
    return {
      summary: {
        total_consumable_products: number(summary.total_consumable_products),
        today_consumption: number(summary.today_consumption),
        low_stock_products: number(summary.low_stock_products),
        appointments_using_consumables: number(summary.appointments_using_consumables),
      },
      pagination: { page, pageSize, totalPages: Math.max(1, Math.ceil(totalRecords / pageSize)), totalRecords },
      items,
    };
  },
};
