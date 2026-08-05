import pool from "../../config/database";
import {
  AssignedServiceRow,
  ConsumableDetail,
  ConsumableKpis,
  ConsumableListFilters,
  ConsumableListResponse,
  ConsumableUsageStats,
  RecentConsumptionRow,
  UnitConversion,
  UnitConversionInput,
  UsageHistoryFilters,
  UsageHistoryResponse,
} from "./consumable-inventory.types";

// Shared "derived Stock Quantity" expression — a partially-consumed bottle
// still counts as 1 until fully empty (CEIL, not FLOOR/ROUND). Products
// without bottle_size just use their raw remaining amount, unchanged from
// today's behavior. Mirrors stockReconciliationRepository's identical
// expression (inventory.repository.ts) — kept as a literal duplicate rather
// than a shared SQL fragment constant because the two queries interpolate it
// into different column aliases/positions; if this drifts out of sync with
// that one, fix both.
const PRODUCT_QTY_EXPR = `CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
  THEN CEIL(COALESCE(p.amount, 0) / p.bottle_size)
  ELSE COALESCE(p.amount, 0) END`;
const TOTAL_STOCK_EXPR = `CASE WHEN p.bottle_size IS NOT NULL AND p.bottle_size > 0
  THEN (${PRODUCT_QTY_EXPR}) * p.bottle_size
  ELSE COALESCE(p.amount, 0) END`;
const STATUS_EXPR = `CASE
  WHEN COALESCE(p.amount, 0) <= 0 THEN 'out_of_stock'
  WHEN p.qty_alert IS NOT NULL AND (${PRODUCT_QTY_EXPR}) <= p.qty_alert THEN 'low'
  ELSE 'healthy' END`;

// pg returns NUMERIC columns as strings (no type parser registered for oid
// 1700 — see config/database.ts), not JS numbers — left unconverted, "100.000"
// renders literally instead of "100" on the frontend (Number.toLocaleString()
// formats; String.toLocaleString() is just a no-op passthrough via
// Object.prototype). Every numeric-typed field on a row returned from this
// module is coerced here, once, at the data-access boundary.
function coerceRowNumerics<T extends Record<string, unknown>>(row: T, fields: (keyof T)[]): T {
  const out = { ...row };
  for (const f of fields) {
    if (out[f] !== null && out[f] !== undefined) (out as any)[f] = Number(out[f]);
  }
  return out;
}

const LIST_ROW_NUMERIC_FIELDS = ["unit_size", "product_qty", "total_stock", "remaining_stock", "qty_alert", "used_today", "used_this_month"] as const;
const DETAIL_ROW_NUMERIC_FIELDS = ["bottle_size", "unit_size", "product_qty", "total_stock", "remaining_stock", "qty_alert", "supply_price"] as const;

function buildWhere(filters: ConsumableListFilters, salonId: string): { where: string; values: unknown[] } {
  // Deactivated products drop out of this page entirely — same "hidden by
  // default" behavior as the Products list (see products.repository.ts).
  const conditions: string[] = [`p.salon_id = $1`, `p.product_type IN ('consumable', 'both')`, `p.is_active = true`];
  const values: unknown[] = [salonId];
  let idx = 2;

  if (filters.search) {
    conditions.push(`p.name ILIKE $${idx++}`);
    values.push(`%${filters.search}%`);
  }
  if (filters.category_id) {
    conditions.push(`p.category_id = $${idx++}`);
    values.push(filters.category_id);
  }
  if (filters.brand_id) {
    conditions.push(`p.brand_id = $${idx++}`);
    values.push(filters.brand_id);
  }
  if (filters.supplier_id) {
    conditions.push(`p.supplier_id = $${idx++}`);
    values.push(filters.supplier_id);
  }
  if (filters.unit) {
    conditions.push(`p.measure_unit = $${idx++}`);
    values.push(filters.unit);
  }
  if (filters.service_id) {
    conditions.push(`EXISTS (SELECT 1 FROM service_consumables sc WHERE sc.product_id = p.id AND sc.service_id = $${idx++})`);
    values.push(filters.service_id);
  }
  if (filters.status && filters.status !== "all") {
    conditions.push(`(${STATUS_EXPR}) = $${idx++}`);
    values.push(filters.status);
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, values };
}

export const consumableInventoryRepository = {
  async list(filters: ConsumableListFilters, salonId: string): Promise<ConsumableListResponse> {
    const { where, values } = buildWhere(filters, salonId);

    const sortMap: Record<string, string> = {
      newest: "p.created_at DESC",
      lowest_stock: `(${PRODUCT_QTY_EXPR}) ASC`,
      most_used: "used_this_month DESC",
      a_z: "p.name ASC",
    };
    const orderBy = sortMap[filters.sort_by ?? "newest"] ?? sortMap.newest;

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
    const offset = (page - 1) * limit;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM products p ${where}`, values);
    const total = countRes.rows[0]?.total ?? 0;

    const dataIdx = values.length + 1;
    const { rows } = await pool.query(
      `SELECT
         p.id AS product_id, p.name, c.name AS category_name, b.name AS brand_name, sup.name AS supplier_name,
         p.measure_unit AS unit, p.bottle_size AS unit_size,
         (${PRODUCT_QTY_EXPR}) AS product_qty,
         (${TOTAL_STOCK_EXPR}) AS total_stock,
         COALESCE(p.amount, 0) AS remaining_stock,
         p.qty_alert,
         COALESCE((
           SELECT SUM(CASE WHEN cu.direction = 'return' THEN -cu.qty ELSE cu.qty END)
           FROM consumable_usage cu
           WHERE cu.product_id = p.id AND cu.created_at >= CURRENT_DATE
         ), 0) AS used_today,
         COALESCE((
           SELECT SUM(CASE WHEN cu.direction = 'return' THEN -cu.qty ELSE cu.qty END)
           FROM consumable_usage cu
           WHERE cu.product_id = p.id AND cu.created_at >= date_trunc('month', CURRENT_DATE)
         ), 0) AS used_this_month,
         COALESCE((SELECT COUNT(*)::int FROM service_consumables sc WHERE sc.product_id = p.id), 0) AS assigned_services_count,
         (SELECT MAX(cu.created_at) FROM consumable_usage cu WHERE cu.product_id = p.id) AS last_used_at,
         (${STATUS_EXPR}) AS status
       FROM products p
       LEFT JOIN service_categories c ON c.id = p.category_id
       LEFT JOIN product_brands b     ON b.id = p.brand_id
       LEFT JOIN suppliers sup        ON sup.id = p.supplier_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${dataIdx} OFFSET $${dataIdx + 1}`,
      [...values, limit, offset]
    );

    return { data: rows.map((r) => coerceRowNumerics(r, [...LIST_ROW_NUMERIC_FIELDS])), total };
  },

  async getKpis(salonId: string): Promise<ConsumableKpis> {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_consumables,
         COALESCE(SUM(COALESCE(p.amount, 0)), 0) AS total_available_stock,
         COUNT(*) FILTER (WHERE (${STATUS_EXPR}) = 'low')::int AS low_stock_items,
         COALESCE((
           SELECT COUNT(DISTINCT sc.service_id)::int
           FROM service_consumables sc
           JOIN products p2 ON p2.id = sc.product_id
           WHERE p2.salon_id = $1 AND p2.product_type IN ('consumable','both') AND p2.is_active = true
         ), 0) AS assigned_services
       FROM products p
       WHERE p.salon_id = $1 AND p.product_type IN ('consumable', 'both') AND p.is_active = true`,
      [salonId]
    );
    return coerceRowNumerics(rows[0], ["total_available_stock"]);
  },

  async getDetail(productId: string, salonId: string): Promise<ConsumableDetail | null> {
    const { rows } = await pool.query(
      `SELECT
         p.id AS product_id, p.name, c.name AS category_name, b.name AS brand_name, sup.name AS supplier_name,
         p.measure_unit, p.measure_unit AS unit, p.bottle_size, p.bottle_size AS unit_size, p.is_active,
         (${PRODUCT_QTY_EXPR}) AS product_qty,
         (${TOTAL_STOCK_EXPR}) AS total_stock,
         COALESCE(p.amount, 0) AS remaining_stock,
         p.qty_alert, p.supply_price,
         COALESCE((SELECT COUNT(*)::int FROM service_consumables sc WHERE sc.product_id = p.id), 0) AS assigned_services_count,
         (SELECT MAX(cu.created_at) FROM consumable_usage cu WHERE cu.product_id = p.id) AS last_used_at,
         (${STATUS_EXPR}) AS status
       FROM products p
       LEFT JOIN service_categories c ON c.id = p.category_id
       LEFT JOIN product_brands b     ON b.id = p.brand_id
       LEFT JOIN suppliers sup        ON sup.id = p.supplier_id
       WHERE p.id = $1 AND p.salon_id = $2 AND p.product_type IN ('consumable', 'both')`,
      [productId, salonId]
    );
    const base = rows[0] ? coerceRowNumerics(rows[0], [...DETAIL_ROW_NUMERIC_FIELDS]) : undefined;
    if (!base) return null;

    const [usageStats, assignedServices, recentConsumption, stockTimeline, unitConversions] = await Promise.all([
      this.getUsageStats(productId, salonId, Number(base.remaining_stock)),
      this.getAssignedServices(productId),
      this.getRecentConsumption(productId, salonId),
      this.getStockTimeline(productId, salonId, Number(base.remaining_stock)),
      this.getUnitConversions(productId),
    ]);

    return {
      ...base, usage_stats: usageStats, assigned_services: assignedServices,
      recent_consumption: recentConsumption, stock_timeline: stockTimeline,
      unit_conversions: unitConversions,
    };
  },

  async getUnitConversions(productId: string): Promise<UnitConversion[]> {
    const { rows } = await pool.query(
      `SELECT id, unit_name, conversion_to_base FROM product_unit_conversions
       WHERE product_id = $1 ORDER BY sort_order ASC, unit_name ASC`,
      [productId]
    );
    return rows.map((r) => ({ id: r.id, unit_name: r.unit_name, conversion_to_base: Number(r.conversion_to_base) }));
  },

  // Delete-all-and-reinsert — same convention as servicesRepository.replaceConsumables().
  async replaceUnitConversions(productId: string, conversions: UnitConversionInput[]): Promise<UnitConversion[]> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM product_unit_conversions WHERE product_id = $1`, [productId]);
      if (conversions.length > 0) {
        const values: unknown[] = [];
        const placeholders = conversions.map((c, i) => {
          values.push(productId, c.unit_name, c.conversion_to_base, i);
          const base = i * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        await client.query(
          `INSERT INTO product_unit_conversions (product_id, unit_name, conversion_to_base, sort_order) VALUES ${placeholders.join(", ")}`,
          values
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return this.getUnitConversions(productId);
  },

  async getUsageStats(productId: string, salonId: string, currentRemaining: number): Promise<ConsumableUsageStats> {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'return' THEN -qty ELSE qty END) FILTER (WHERE created_at >= CURRENT_DATE), 0) AS used_today,
         COALESCE(SUM(CASE WHEN direction = 'return' THEN -qty ELSE qty END) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE)), 0) AS used_this_week,
         COALESCE(SUM(CASE WHEN direction = 'return' THEN -qty ELSE qty END) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0) AS used_this_month,
         -- Average per SERVICE USE: one "use" is one appointment-completion deduction
         -- event (direction='deduct', source='appointment_complete'/'appointment_adjustment'),
         -- not one ledger row — a manual (source='manual') adjustment isn't a service use.
         COALESCE(AVG(qty) FILTER (WHERE direction = 'deduct' AND source IN ('appointment_complete','appointment_adjustment')), 0) AS average_per_service
       FROM consumable_usage
       WHERE product_id = $1 AND salon_id = $2`,
      [productId, salonId]
    );
    const r = rows[0];
    const avgPerService = Number(r.average_per_service) || 0;
    return {
      used_today: Number(r.used_today) || 0,
      used_this_week: Number(r.used_this_week) || 0,
      used_this_month: Number(r.used_this_month) || 0,
      average_per_service: avgPerService,
      estimated_services_remaining: avgPerService > 0 ? Math.floor(currentRemaining / avgPerService) : null,
    };
  },

  async getAssignedServices(productId: string): Promise<AssignedServiceRow[]> {
    const { rows } = await pool.query(
      `SELECT s.id AS service_id, s.name, sc.qty, sc.unit
       FROM service_consumables sc
       JOIN services s ON s.id = sc.service_id
       WHERE sc.product_id = $1
       ORDER BY s.name ASC`,
      [productId]
    );
    return rows.map((r) => coerceRowNumerics(r, ["qty"]));
  },

  async getRecentConsumption(productId: string, salonId: string, limit = 10): Promise<RecentConsumptionRow[]> {
    const { rows } = await pool.query(
      `SELECT
         cu.created_at AS date,
         s.name AS service_name,
         CONCAT(st.first_name, ' ', st.last_name) AS staff_name,
         cu.qty, cu.direction
       FROM consumable_usage cu
       LEFT JOIN services s ON s.id = cu.service_id
       LEFT JOIN appointment_service_consumables asc_
              ON asc_.appointment_id = cu.booking_id
             AND asc_.service_row_id = cu.service_row_id
             AND asc_.product_id = cu.product_id
       LEFT JOIN staff st ON st.id = asc_.staff_id
       WHERE cu.product_id = $1 AND cu.salon_id = $2
       ORDER BY cu.created_at DESC
       LIMIT $3`,
      [productId, salonId, limit]
    );
    return rows.map((r) => coerceRowNumerics(r, ["qty"]));
  },

  // Reconstructs the last few distinct "days with activity" closing balances by
  // walking backward from the CURRENT remaining stock — real recorded ledger
  // data, not a fabricated curve. Only as many points as there is history for
  // (fewer than 4 on a newly-tracked product is expected, not an error).
  async getStockTimeline(productId: string, salonId: string, currentRemaining: number): Promise<{ label: string; remaining: number }[]> {
    const { rows } = await pool.query(
      `SELECT created_at::date AS day,
              SUM(CASE WHEN direction = 'return' THEN -qty ELSE qty END) AS net_used
       FROM consumable_usage
       WHERE product_id = $1 AND salon_id = $2
       GROUP BY created_at::date
       ORDER BY day DESC
       LIMIT 4`,
      [productId, salonId]
    );

    const points: { label: string; remaining: number }[] = [{ label: "Current", remaining: currentRemaining }];
    let runningRemaining = currentRemaining;
    for (const row of rows) {
      // `runningRemaining` going INTO this day (i.e. its closing balance) is
      // today's/prior point's remaining PLUS what this day itself consumed —
      // walking backward in time, each day's usage gets added back.
      runningRemaining += Number(row.net_used);
      points.push({ label: new Date(row.day).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), remaining: runningRemaining });
    }
    return points;
  },

  // Full, filterable, paginated usage log across every consumable — the
  // dedicated Usage History page. Distinct from getRecentConsumption above,
  // which is a fixed 10-row preview scoped to one product for the side panel.
  async listUsageHistory(filters: UsageHistoryFilters, salonId: string): Promise<UsageHistoryResponse> {
    const conditions: string[] = [`p.salon_id = $1`];
    const values: unknown[] = [salonId];
    let idx = 2;

    if (filters.product_id) { conditions.push(`cu.product_id = $${idx++}`); values.push(filters.product_id); }
    if (filters.service_id) { conditions.push(`cu.service_id = $${idx++}`); values.push(filters.service_id); }
    if (filters.direction) { conditions.push(`cu.direction = $${idx++}`); values.push(filters.direction); }
    if (filters.from) { conditions.push(`cu.created_at >= $${idx++}`); values.push(filters.from); }
    if (filters.to) { conditions.push(`cu.created_at < ($${idx++}::date + interval '1 day')`); values.push(filters.to); }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 25));
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM consumable_usage cu JOIN products p ON p.id = cu.product_id ${where}`,
      values
    );
    const total = countRes.rows[0]?.total ?? 0;

    const dataIdx = values.length + 1;
    const { rows } = await pool.query(
      `SELECT
         cu.id, cu.created_at AS date, cu.product_id, p.name AS product_name, cu.unit,
         s.name AS service_name,
         CONCAT(st.first_name, ' ', st.last_name) AS staff_name,
         cu.qty, cu.direction, cu.source
       FROM consumable_usage cu
       JOIN products p ON p.id = cu.product_id
       LEFT JOIN services s ON s.id = cu.service_id
       LEFT JOIN appointment_service_consumables asc_
              ON asc_.appointment_id = cu.booking_id
             AND asc_.service_row_id = cu.service_row_id
             AND asc_.product_id = cu.product_id
       LEFT JOIN staff st ON st.id = asc_.staff_id
       ${where}
       ORDER BY cu.created_at DESC
       LIMIT $${dataIdx} OFFSET $${dataIdx + 1}`,
      [...values, limit, offset]
    );

    return { data: rows.map((r) => coerceRowNumerics(r, ["qty"])), total };
  },
};
