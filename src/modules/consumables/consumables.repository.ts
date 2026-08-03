import pool from "../../config/database";
import { ConsumableUsageHistoryFilters, ConsumableUsageItem, ConsumableUsageRequest, ConsumableUsageResponse } from "./consumables.types";
import { consumableStockSql } from "./consumable-stock";

const SORT_COLUMNS = {
  date: "cu.created_at",
  product_name: "p.name",
  qty_used: "cu.qty",
  remaining_stock: "cu.remaining_stock",
} as const;

export const consumablesRepository = {
  async history(salonId: string, filters: ConsumableUsageHistoryFilters) {
    const values: unknown[] = [salonId];
    const conditions = ["cu.salon_id = $1"];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };
    if (filters.date_from) add("cu.created_at >= ?::date", filters.date_from);
    if (filters.date_to) add("cu.created_at < (?::date + INTERVAL '1 day')", filters.date_to);
    if (filters.product_id) add("cu.product_id = ?", filters.product_id);
    if (filters.category_id) add("p.category_id = ?", filters.category_id);
    if (filters.service_id) add("cu.service_id = ?", filters.service_id);
    if (filters.staff_id) add("cu.staff_id = ?", filters.staff_id);
    if (filters.branch_id) add("cu.branch_id = ?", filters.branch_id);
    if (filters.status) add("cu.status = ?", filters.status);
    const where = conditions.join(" AND ");
    const offset = (filters.page - 1) * filters.pageSize;
    const limitClause = filters.is_export ? "" : `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const pageValues = filters.is_export ? [] : [filters.pageSize, offset];
    const select = `SELECT cu.id, cu.created_at AS date, cu.booking_id AS appointment_id,
        COALESCE(sa.invoice_number, cu.invoice_id::text) AS invoice,
        cu.branch_id, b.name AS branch_name, cu.service_id, s.name AS service_name,
        cu.staff_id, CONCAT_WS(' ', st.first_name, st.last_name) AS staff_name,
        cu.product_id, p.name AS product_name, p.category_id, c.name AS category_name,
        cu.qty AS quantity_used, cu.remaining_stock, cu.unit, cu.status,
        cu.supply_price, cu.usage_value, cu.is_manual, cu.configured_quantity, cu.notes
      FROM consumable_usage cu
      JOIN products p ON p.id = cu.product_id AND p.salon_id = cu.salon_id
      LEFT JOIN services s ON s.id = cu.service_id
      LEFT JOIN staff st ON st.id = cu.staff_id
      LEFT JOIN branches b ON b.id = cu.branch_id
      LEFT JOIN sales sa ON sa.id = cu.invoice_id
      LEFT JOIN service_categories c ON c.id = p.category_id
      WHERE ${where}`;
    const [dataResult, countResult] = await Promise.all([
      pool.query(`${select} ORDER BY cu.created_at DESC, cu.id DESC ${limitClause}`, [...values, ...pageValues]),
      pool.query(`SELECT COUNT(*)::int AS total FROM consumable_usage cu
        JOIN products p ON p.id = cu.product_id AND p.salon_id = cu.salon_id WHERE ${where}`, values),
    ]);
    const totalRecords = Number(countResult.rows[0]?.total ?? 0);
    const effectiveLimit = filters.is_export ? Math.max(totalRecords, 1) : filters.pageSize;
    return {
      pagination: {
        page: filters.is_export ? 1 : filters.page, pageSize: effectiveLimit,
        totalPages: Math.max(1, Math.ceil(totalRecords / effectiveLimit)), totalRecords,
      },
      items: dataResult.rows.map((row) => ({
        ...row,
        quantity_used: Number(row.quantity_used),
        remaining_stock: row.remaining_stock == null ? null : Number(row.remaining_stock),
        supply_price: row.supply_price == null ? null : Number(row.supply_price),
        usage_value: row.usage_value == null ? null : Number(row.usage_value),
        configured_quantity: row.configured_quantity == null ? null : Number(row.configured_quantity),
      })),
    };
  },

  async usage(request: ConsumableUsageRequest): Promise<ConsumableUsageResponse> {
    const sort = request.sort ?? { field: "product_name" as const, direction: "asc" as const };
    const orderBy = SORT_COLUMNS[sort.field];
    const direction = sort.direction.toUpperCase();
    const page = request.page;
    const pageSize = request.pageSize;
    const offset = (page - 1) * pageSize;
    const values: unknown[] = [request.salon_id];
    const conditions = ["cu.salon_id = $1"];
    const filters = request.filters ?? {};
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (request.search) {
      values.push(`%${request.search}%`);
      conditions.push(`(p.name ILIKE $${values.length} OR s.name ILIKE $${values.length} OR CONCAT_WS(' ', st.first_name, st.last_name) ILIKE $${values.length})`);
    }
    if (filters.date_from) add("cu.created_at >= ?::date", filters.date_from);
    if (filters.date_to) add("cu.created_at < (?::date + INTERVAL '1 day')", filters.date_to);
    if (filters.product_id) add("cu.product_id = ?", filters.product_id);
    if (filters.category_id) add("p.category_id = ?", filters.category_id);
    if (filters.service_id) add("cu.service_id = ?", filters.service_id);
    if (filters.staff_id) add("cu.staff_id = ?", filters.staff_id);
    if (filters.branch_id) add("cu.branch_id = ?", filters.branch_id);
    if (filters.unit) add("LOWER(cu.unit) = LOWER(?)", filters.unit);
    if (filters.status && filters.status !== "completed") conditions.push("FALSE");

    const where = conditions.join(" AND ");
    const from = `FROM consumable_usage cu
      JOIN products p ON p.id = cu.product_id AND p.salon_id = cu.salon_id
      LEFT JOIN services s ON s.id = cu.service_id
      LEFT JOIN staff st ON st.id = cu.staff_id
      LEFT JOIN sales sa ON sa.id = cu.invoice_id
      LEFT JOIN service_categories c ON c.id = p.category_id`;
    const select = `SELECT cu.id, cu.created_at AS date,
        cu.product_id, p.name AS product_name, p.category_id, c.name AS category_name,
        cu.service_id, s.name AS service_name,
        cu.staff_id, CONCAT_WS(' ', st.first_name, st.last_name) AS staff_name,
        cu.qty AS qty_used, cu.unit, cu.remaining_stock, cu.supply_price,
        cu.booking_id AS appointment_id,
        COALESCE(sa.invoice_number, cu.invoice_id::text) AS invoice_number,
        cu.branch_id, 'completed'::text AS status,
        cu.is_manual, cu.configured_quantity, cu.notes
      ${from}
      WHERE ${where}`;
    const pageValues = [...values, pageSize, offset];

    const [itemsResult, countResult, summaryResult] = await Promise.all([
      pool.query(`${select} ORDER BY ${orderBy} ${direction} NULLS LAST, cu.id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues),
      pool.query(`SELECT COUNT(*)::int AS total ${from} WHERE ${where}`, values),
      pool.query(`SELECT COUNT(DISTINCT cu.product_id)::int AS total_consumables,
             COALESCE(SUM(cu.qty), 0)::numeric AS total_quantity_used,
             COALESCE(SUM(ABS(cu.qty) * COALESCE(cu.supply_price, 0)), 0)::numeric AS current_stock_value,
             COUNT(DISTINCT p.id) FILTER (
               WHERE COALESCE(p.qty_alert, 0) > 0
                 AND (${consumableStockSql.productQuantity("p")}) <= COALESCE(p.qty_alert, 0)
             )::int AS low_stock_items
        ${from}
        WHERE ${where}`, values),
    ]);

    const number = (value: unknown) => Number(value ?? 0);
    const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
    const items: ConsumableUsageItem[] = itemsResult.rows.map((row) => ({
      ...row,
      qty_used: number(row.qty_used),
      remaining_stock: number(row.remaining_stock),
      supply_price: nullableNumber(row.supply_price),
      configured_quantity: nullableNumber(row.configured_quantity),
    }));
    const totalRecords = number(countResult.rows[0]?.total);
    const summary = summaryResult.rows[0] ?? {};
    return {
      summary: {
        total_consumables: number(summary.total_consumables),
        total_quantity_used: number(summary.total_quantity_used),
        current_stock_value: number(summary.current_stock_value),
        low_stock_items: number(summary.low_stock_items),
      },
      pagination: { page, pageSize, totalPages: Math.max(1, Math.ceil(totalRecords / pageSize)), totalRecords },
      items,
    };
  },
};
