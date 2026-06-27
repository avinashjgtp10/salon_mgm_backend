import pool from "../../config/database";
import { getEmployeePerformanceSortColumn } from "./reports.employee.helpers";
import {
  aggregateRevenueRowsByBuckets,
  assignRevenueServiceColors,
  buildRevenueTrendBuckets,
  buildPreviousRevenueTrendBuckets,
  buildTrendPoints,
  calculateRevenueKpi,
  formatRevenueCards,
  getRevenueCalendarWindow,
  percentChange,
  resolveRevenueDateRange,
} from "./reports.revenue.helpers";
import type {
  ReportPeriod,
  RevenueReport,
  RevenueByServiceReport,
  EmployeePerformanceReport,
  StaffRevenueAnalyticsReport,
  StaffProductSalesReport,
  StaffServiceSalesReport,
  AppointmentsReport,
  ClientsReport,
  StaffReport,
  ServicesReport,
  EmployeePerformanceRow,
  StaffRevenueAnalyticsRow,
  StaffProductSalesRow,
  StaffServiceSalesRow,
  RevenueTrendPoint,
  RevenueServiceItem,
  SalesDashboardEmployeeAppointmentDetail,
  SalesDashboardEmployeeDrillDown,
  SalesDashboardEmployeeProductDetail,
  SalesDashboardEmployeeRow,
  SalesDashboardResponse,
  SalesDashboardSection,
  SalesDashboardEmployeeServiceDetail,
  SalesDashboardTrendGroup,
  ClientGrowthPoint,
  StaffPerformance,
  ServicePerformance,
} from "./reports.types";
import type { NormalizedEmployeePerformanceQuery } from "./reports.employee.helpers";

interface NormalizedStaffRevenueAnalyticsQuery {
  from: string;
  to: string;
  staffId?: string;
  role?: string;
  viewType: "day" | "week" | "month" | "year";
}

interface NormalizedStaffProductSalesQuery {
  from: string;
  to: string;
  staffId?: string;
  role?: string;
  productCategory?: string;
  productName?: string;
  search?: string;
  sortBy: "highest_revenue" | "lowest_revenue" | "highest_quantity_sold" | "lowest_quantity_sold" | "highest_avg_product_value";
}

interface NormalizedStaffServiceSalesQuery {
  from: string;
  to: string;
  staffId?: string;
  role?: string;
  serviceCategory?: string;
  serviceName?: string;
  sortBy: "highest_revenue" | "lowest_revenue" | "most_services_completed" | "least_services_completed" | "most_customers_served";
}

interface NormalizedAppointmentAnalyticsQuery {
  period: ReportPeriod;
  from?: string;
  to?: string;
  staffId?: string;
  serviceId?: string;
  branchId?: string;
  search?: string;
  sortBy: "appointmentDate" | "amount" | "status";
  sortOrder: "asc" | "desc";
}

interface NormalizedSalesDashboardQuery {
  from: string;
  to: string;
  employeeId?: string;
  employeeType?: string;
  activity?: string;
  branchId?: string;
  groupBy: SalesDashboardTrendGroup;
  search: string;
  sortBy: "revenue" | "servicesSold" | "productRevenue" | "averageTicket";
  sortOrder: "asc" | "desc";
  page: number;
  pageSize: number;
  sections: SalesDashboardSection[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const r1 = (n: number) => Math.round(n * 10) / 10;

const pct = (curr: number, prev: number): number => {
  if (prev < 1) return 0; // no meaningful previous data — show neutral 0%
  const raw = ((curr - prev) / prev) * 100;
  return r1(Math.max(-99, Math.min(999, raw))); // cap at ±999%
};

interface PeriodConfig {
  interval: string;
  prevInterval: string;
  trunc: string;
  labelFmt: string;
  numDays: number;
}

function getPeriodConfig(period: ReportPeriod): PeriodConfig {
  const configs: Record<ReportPeriod, PeriodConfig> = {
    "today":  { interval: "1 day",     prevInterval: "2 days",    trunc: "day",   labelFmt: "Dy",     numDays: 1   },
    "7d":     { interval: "7 days",    prevInterval: "14 days",   trunc: "day",   labelFmt: "Dy",     numDays: 7   },
    "15d":    { interval: "15 days",   prevInterval: "30 days",   trunc: "day",   labelFmt: "DD Mon", numDays: 15  },
    "30d":    { interval: "30 days",   prevInterval: "60 days",   trunc: "day",   labelFmt: "DD Mon", numDays: 30  },
    "60d":    { interval: "60 days",   prevInterval: "120 days",  trunc: "day",   labelFmt: "DD Mon", numDays: 60  },
    "90d":    { interval: "90 days",   prevInterval: "180 days",  trunc: "week",  labelFmt: "DD Mon", numDays: 90  },
    "12m":    { interval: "12 months", prevInterval: "24 months", trunc: "month", labelFmt: "Mon",    numDays: 365 },
    "custom": { interval: "30 days",   prevInterval: "60 days",   trunc: "day",   labelFmt: "DD Mon", numDays: 30  },
  };
  return configs[period];
}

function buildDateExprs(
  period: ReportPeriod,
  from?: string,
  to?: string,
): {
  startExpr: string;
  endExpr: string;
  prevStart: string;
  prevEnd: string;
  trunc: string;
  labelFmt: string;
  numDays: number;
  extraParams: any[];
} {
  const cfg = getPeriodConfig(period);

  if (from && to) {
    const diffMs   = new Date(to).getTime() - new Date(from).getTime();
    const diffDays = Math.max(1, Math.round(diffMs / 86_400_000) + 1);
    const trunc    = diffDays <= 14 ? "day" : diffDays <= 90 ? "week" : "month";
    const labelFmt = trunc === "month" ? "Mon" : "DD Mon";
    return {
      startExpr: "$2::date",
      endExpr:   "($3::date + INTERVAL '1 day')",
      prevStart: "($2::date - (($3::date - $2::date) + 1) * INTERVAL '1 day')",
      prevEnd:   "$2::date",
      trunc,
      labelFmt,
      numDays: diffDays,
      extraParams: [from, to],
    };
  }

  return {
    startExpr: `NOW() - INTERVAL '${cfg.interval}'`,
    endExpr:   "NOW()",
    prevStart: `NOW() - INTERVAL '${cfg.prevInterval}'`,
    prevEnd:   `NOW() - INTERVAL '${cfg.interval}'`,
    trunc:     cfg.trunc,
    labelFmt:  cfg.labelFmt,
    numDays:   cfg.numDays,
    extraParams: [],
  };
}

let hasStaffDepartmentColumnCache: boolean | null = null;
let hasStaffSchedulesTableCache: boolean | null = null;
let hasAppointmentSourceColumnCache: boolean | null = null;

async function hasStaffDepartmentColumn(): Promise<boolean> {
  if (hasStaffDepartmentColumnCache !== null) return hasStaffDepartmentColumnCache;

  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'staff'
         AND column_name = 'department'
     ) AS exists`,
  );

  hasStaffDepartmentColumnCache = rows[0]?.exists === true;
  return hasStaffDepartmentColumnCache;
}

async function hasStaffSchedulesTable(): Promise<boolean> {
  if (hasStaffSchedulesTableCache !== null) return hasStaffSchedulesTableCache;

  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'staff_schedules'
     ) AS exists`,
  );

  hasStaffSchedulesTableCache = rows[0]?.exists === true;
  return hasStaffSchedulesTableCache;
}

async function hasAppointmentSourceColumn(): Promise<boolean> {
  if (hasAppointmentSourceColumnCache !== null) return hasAppointmentSourceColumnCache;

  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'appointments'
         AND column_name = 'source'
     ) AS exists`,
  );

  hasAppointmentSourceColumnCache = rows[0]?.exists === true;
  return hasAppointmentSourceColumnCache;
}

function formatMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSalesDashboardBaseQuery(
  salonId: string,
  query: NormalizedSalesDashboardQuery,
): { cte: string; params: any[] } {
  const params: any[] = [salonId, query.from, query.to];
  const filters = [
    `sl.salon_id = $1`,
    `sl.status = 'completed'`,
    `sl.created_at >= $2::date`,
    `sl.created_at < ($3::date + INTERVAL '1 day')`,
  ];

  if (query.employeeId) {
    params.push(query.employeeId);
    filters.push(`COALESCE(si.staff_id::text, sl.staff_id::text, a.staff_id::text, 'unassigned') = $${params.length}`);
  }

  if (query.employeeType) {
    params.push(`%${query.employeeType}%`);
    filters.push(`COALESCE(st.employment_type, '') ILIKE $${params.length}`);
  }

  if (query.branchId) {
    params.push(query.branchId);
    filters.push(`COALESCE(a.branch_id::text, '') = $${params.length}`);
  }

  if (query.activity && query.activity !== "all") {
    params.push(query.activity);
  }

  const activityFilter = query.activity && query.activity !== "all"
    ? `WHERE sale_type = $${params.length}`
    : "";

  const cte = `
    WITH sales_line_items AS (
      SELECT
        sl.id::text AS sale_id,
        COALESCE(sl.appointment_id::text, '') AS appointment_id,
        COALESCE(sl.client_id::text, '') AS client_id,
        COALESCE(si.staff_id::text, sl.staff_id::text, a.staff_id::text, 'unassigned') AS employee_id,
        COALESCE(NULLIF(TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')), ''), 'Unassigned') AS employee_name,
        COALESCE(NULLIF(st.designation, ''), 'Staff') AS role,
        COALESCE(NULLIF(st.employment_type, ''), 'Unknown') AS employee_type,
        COALESCE(a.branch_id::text, '') AS branch_id,
        COALESCE(c.full_name, NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), 'Walk-in Client') AS client_name,
        COALESCE(a.scheduled_at, sl.created_at) AS appointment_date,
        sl.created_at AS sale_date,
        COALESCE(sl.subtotal, 0)::numeric AS subtotal,
        COALESCE(sl.tax_amount, 0)::numeric AS tax_amount,
        COALESCE(sl.total_amount, 0)::numeric AS total_amount,
        COALESCE(NULLIF(sl.payment_method, ''), 'unknown') AS payment_method,
        COALESCE(adv.advance_added, 0)::numeric AS advance_added,
        CASE
          WHEN si.item_type = 'product' THEN 'product'
          WHEN si.item_type = 'membership' THEN 'membership'
          WHEN si.item_type = 'gift_card' THEN 'gift_card'
          WHEN si.item_type = 'service' AND a.id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(a.package_items) = 'array' THEN a.package_items
                ELSE '[]'::jsonb
              END
            ) pkg
            WHERE COALESCE(pkg->>'package_id', pkg->>'id', '') = COALESCE(si.item_id::text, '')
               OR LOWER(COALESCE(pkg->>'name', '')) = LOWER(COALESCE(si.name, ''))
          ) THEN 'package'
          ELSE 'service'
        END AS sale_type,
        COALESCE(NULLIF(si.name, ''), 'Item') AS item_name,
        COALESCE(si.quantity, 1)::numeric AS quantity,
        COALESCE(si.total_price, 0)::numeric AS line_revenue
      FROM sales sl
      JOIN sale_items si
        ON si.sale_id = sl.id
      LEFT JOIN appointments a
        ON a.id = sl.appointment_id
      LEFT JOIN staff st
        ON st.id = COALESCE(si.staff_id, sl.staff_id, a.staff_id)
      LEFT JOIN clients c
        ON c.id = sl.client_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(py.ewallet_used), 0)::numeric AS advance_added
        FROM payments py
        WHERE py.salon_id = sl.salon_id
          AND py.status IN ('partial', 'completed')
          AND (
            (sl.appointment_id IS NOT NULL AND py.appointment_id = sl.appointment_id)
            OR (
              sl.appointment_id IS NULL
              AND py.client_id = sl.client_id
              AND DATE(py.created_at) = DATE(sl.created_at)
              AND COALESCE(py.amount, py.net_amount, 0)::numeric = COALESCE(sl.total_amount, 0)::numeric
            )
          )
      ) adv ON TRUE
      WHERE ${filters.join("\n        AND ")}
    ),
    filtered_line_items AS (
      SELECT *
      FROM sales_line_items
      ${activityFilter}
    ),
    filtered_sales AS (
      SELECT DISTINCT
        sale_id,
        appointment_id,
        client_id,
        appointment_date,
        sale_date,
        subtotal,
        tax_amount,
        total_amount,
        payment_method,
        advance_added,
        client_name
      FROM filtered_line_items
    )`;

  return { cte, params };
}

// ── Repository ────────────────────────────────────────────────────────────────
export const reportsRepository = {

  // ── Revenue ─────────────────────────────────────────────────────────────────
  async getRevenue(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<RevenueReport> {
    const range = resolveRevenueDateRange(period, from, to);
    const buckets = buildRevenueTrendBuckets(range);
    const previousBuckets = buildPreviousRevenueTrendBuckets(range, buckets);
    const {
      monthStart,
      nextMonthStart,
      previousMonthStart,
      todayStart,
      tomorrowStart,
      yesterdayStart,
    } = getRevenueCalendarWindow();

    const revenueCte = `
      WITH revenue_transactions AS (
        SELECT
          p.id AS transaction_id,
          COALESCE(p.paid_at, p.created_at) AS transaction_at,
          COALESCE(NULLIF(p.paid_amount, 0), p.net_amount, p.amount, 0)::numeric AS amount
        FROM payments p
        WHERE p.salon_id = $1
          AND p.status IN ('partial', 'completed')
          AND COALESCE(NULLIF(p.paid_amount, 0), p.net_amount, p.amount, 0) > 0
          AND COALESCE(p.paid_at, p.created_at) >= $2
          AND COALESCE(p.paid_at, p.created_at) < $3
      )
    `;

    const appointmentPaidPredicate = `
      EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.appointment_id = a.id
          AND p.status IN ('partial', 'completed')
      )
    `;

    const serviceLineItemsCte = `
      WITH service_line_items AS (
        SELECT
          s.created_at AS transaction_at,
          COALESCE(si.item_id::text, si.name) AS service_key,
          COALESCE(NULLIF(si.name, ''), 'Service') AS service_name,
          COALESCE(si.quantity, 1)::int AS quantity,
          COALESCE(si.total_price, 0)::numeric AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.salon_id = $1
          AND s.status = 'completed'
          AND si.item_type = 'service'
          AND s.created_at >= $2
          AND s.created_at < $3

        UNION ALL

        SELECT
          a.scheduled_at AS transaction_at,
          COALESCE(item->>'service_id', item->>'name', a.id::text) AS service_key,
          COALESCE(NULLIF(item->>'name', ''), a.title, 'Service') AS service_name,
          COALESCE((item->>'quantity')::int, 1) AS quantity,
          (COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1))::numeric AS revenue
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
        ) AS item
        WHERE a.salon_id = $1
          AND a.status = 'completed'
          AND ${appointmentPaidPredicate}
          AND a.scheduled_at >= $2
          AND a.scheduled_at < $3
          AND NOT EXISTS (
            SELECT 1
            FROM sales s
            WHERE s.appointment_id = a.id
              AND s.status = 'completed'
          )
      )
    `;

    const lowerBound = new Date(Math.min(range.previousStart.getTime(), previousMonthStart.getTime(), yesterdayStart.getTime()));
    const upperBound = new Date(Math.max(range.end.getTime(), nextMonthStart.getTime()));

    const [
      currentSummaryRows,
      previousSummaryRows,
      trendCurrentRows,
      trendPreviousRows,
      calendarRows,
      currentServiceRows,
      previousServiceRows,
    ] = await Promise.all([
      pool.query<{ total_revenue: string; total_transactions: string }>(
        `${revenueCte}
         SELECT
           COALESCE(SUM(amount), 0)::numeric AS total_revenue,
           COUNT(*)::int AS total_transactions
         FROM revenue_transactions`,
        [salonId, range.start.toISOString(), range.end.toISOString()],
      ),
      pool.query<{ total_revenue: string; total_transactions: string }>(
        `${revenueCte}
         SELECT
           COALESCE(SUM(amount), 0)::numeric AS total_revenue,
           COUNT(*)::int AS total_transactions
         FROM revenue_transactions`,
        [salonId, range.previousStart.toISOString(), range.previousEnd.toISOString()],
      ),
      pool.query<{ transaction_at: string; amount: string }>(
        `${revenueCte}
         SELECT
           transaction_at,
           amount
         FROM revenue_transactions
         ORDER BY transaction_at ASC`,
        [
          salonId,
          range.start.toISOString(),
          range.end.toISOString(),
        ],
      ),
      pool.query<{ transaction_at: string; amount: string }>(
        `${revenueCte}
         SELECT
           transaction_at,
           amount
         FROM revenue_transactions
         ORDER BY transaction_at ASC`,
        [
          salonId,
          range.previousStart.toISOString(),
          range.previousEnd.toISOString(),
        ],
      ),
      pool.query<{
        current_month_revenue: string;
        previous_month_revenue: string;
        today_revenue: string;
        yesterday_revenue: string;
      }>(
        `${revenueCte}
         SELECT
           COALESCE(SUM(amount) FILTER (
             WHERE transaction_at >= $4 AND transaction_at < $5
           ), 0)::numeric AS current_month_revenue,
           COALESCE(SUM(amount) FILTER (
             WHERE transaction_at >= $6 AND transaction_at < $4
           ), 0)::numeric AS previous_month_revenue,
           COALESCE(SUM(amount) FILTER (
             WHERE transaction_at >= $7 AND transaction_at < $8
           ), 0)::numeric AS today_revenue,
           COALESCE(SUM(amount) FILTER (
             WHERE transaction_at >= $9 AND transaction_at < $7
           ), 0)::numeric AS yesterday_revenue
         FROM revenue_transactions`,
        [
          salonId,
          lowerBound.toISOString(),
          upperBound.toISOString(),
          monthStart.toISOString(),
          nextMonthStart.toISOString(),
          previousMonthStart.toISOString(),
          todayStart.toISOString(),
          tomorrowStart.toISOString(),
          yesterdayStart.toISOString(),
        ],
      ),
      pool.query<{ service_key: string; service_name: string; bookings: string; revenue: string }>(
        `${serviceLineItemsCte}
         SELECT
           service_key,
           service_name,
           COALESCE(SUM(quantity), 0)::int AS bookings,
           COALESCE(SUM(revenue), 0)::numeric AS revenue
         FROM service_line_items
         GROUP BY service_key, service_name
         ORDER BY revenue DESC, bookings DESC, service_name ASC`,
        [
          salonId,
          range.start.toISOString(),
          range.end.toISOString(),
        ],
      ),
      pool.query<{ service_key: string; revenue: string }>(
        `${serviceLineItemsCte}
         SELECT
           service_key,
           COALESCE(SUM(revenue), 0)::numeric AS revenue
         FROM service_line_items
         GROUP BY service_key`,
        [
          salonId,
          range.previousStart.toISOString(),
          range.previousEnd.toISOString(),
        ],
      ),
    ]);

    const currentRangeRevenue = parseFloat(currentSummaryRows.rows[0]?.total_revenue ?? "0");
    const previousRangeRevenue = parseFloat(previousSummaryRows.rows[0]?.total_revenue ?? "0");
    const totalTransactions = parseInt(currentSummaryRows.rows[0]?.total_transactions ?? "0", 10);
    const previousTransactions = parseInt(previousSummaryRows.rows[0]?.total_transactions ?? "0", 10);

    const currentTrendMap = aggregateRevenueRowsByBuckets(
      trendCurrentRows.rows.map((row) => ({
        transactionAt: row.transaction_at,
        amount: parseFloat(row.amount),
      })),
      buckets,
    );

    const previousTrendMap = aggregateRevenueRowsByBuckets(
      trendPreviousRows.rows.map((row) => ({
        transactionAt: row.transaction_at,
        amount: parseFloat(row.amount),
      })),
      previousBuckets,
    );

    const trend: RevenueTrendPoint[] = buildTrendPoints(buckets, currentTrendMap, previousTrendMap);

    const servicePreviousMap = new Map<string, number>(
      previousServiceRows.rows.map((row) => [row.service_key, parseFloat(row.revenue)]),
    );

    const servicesBase = currentServiceRows.rows.map((row): Omit<RevenueServiceItem, "color"> => {
      const revenue = parseFloat(row.revenue ?? "0");
      const bookings = parseInt(row.bookings ?? "0", 10);
      const previousRevenue = servicePreviousMap.get(row.service_key) ?? 0;

      return {
        name: row.service_name,
        bookings,
        revenue: r1(revenue),
        avgTicket: bookings > 0 ? r1(revenue / bookings) : 0,
        growth: percentChange(revenue, previousRevenue),
      };
    });

    const services = assignRevenueServiceColors(servicesBase);

    const calendar = calendarRows.rows[0];
    const kpi = calculateRevenueKpi({
      currentRangeRevenue,
      previousRangeRevenue,
      totalTransactions,
      previousTransactions,
      currentMonthRevenue: parseFloat(calendar?.current_month_revenue ?? "0"),
      previousMonthRevenue: parseFloat(calendar?.previous_month_revenue ?? "0"),
      todayRevenue: parseFloat(calendar?.today_revenue ?? "0"),
      yesterdayRevenue: parseFloat(calendar?.yesterday_revenue ?? "0"),
      days: range.days,
    });

    return {
      kpi,
      trend,
      services,
      cards: formatRevenueCards(kpi),
    };
  },

  async getRevenueByService(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<RevenueByServiceReport> {
    const range = resolveRevenueDateRange(period, from, to);

    const appointmentPaidPredicate = `
      EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.appointment_id = a.id
          AND p.status = 'completed'
      )
    `;

    const serviceRevenueCte = `
      WITH service_revenue_lines AS (
        SELECT
          COALESCE(si.item_id::text, si.name) AS service_key,
          COALESCE(NULLIF(si.name, ''), srv.name, 'Service') AS service_name,
          COALESCE(cat.name, 'Uncategorized') AS category,
          COALESCE(si.quantity, 1)::int AS booking_count,
          COALESCE(si.total_price, 0)::numeric AS revenue
        FROM sale_items si
        JOIN sales sl ON sl.id = si.sale_id
        LEFT JOIN services srv ON (
          srv.id::text = si.item_id::text
          OR (si.item_id IS NULL AND lower(srv.name) = lower(NULLIF(si.name, '')))
        )
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
          AND si.item_type = 'service'
          AND sl.created_at >= $2
          AND sl.created_at < $3

        UNION ALL

        SELECT
          COALESCE(item->>'service_id', item->>'name', a.id::text) AS service_key,
          COALESCE(NULLIF(item->>'name', ''), srv.name, a.title, 'Service') AS service_name,
          COALESCE(cat.name, 'Uncategorized') AS category,
          COALESCE((item->>'quantity')::int, 1) AS booking_count,
          (COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1))::numeric AS revenue
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
        ) AS item
        LEFT JOIN services srv ON (
          srv.id::text = (item->>'service_id')
          OR ((item->>'service_id') IS NULL OR trim(item->>'service_id') = '')
             AND lower(srv.name) = lower(NULLIF(item->>'name', ''))
        )
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        WHERE a.salon_id = $1
          AND a.status = 'completed'
          AND ${appointmentPaidPredicate}
          AND a.scheduled_at >= $2
          AND a.scheduled_at < $3
          AND NOT EXISTS (
            SELECT 1
            FROM sales sl
            WHERE sl.appointment_id = a.id
              AND sl.status = 'completed'
          )
      )
    `;

    const { rows } = await pool.query<{
      service_id: string;
      service_name: string;
      category: string;
      booking_count: string;
      revenue: string;
    }>(
      `${serviceRevenueCte}
       SELECT
         service_key AS service_id,
         service_name,
         category,
         COALESCE(SUM(booking_count), 0)::int AS booking_count,
         COALESCE(SUM(revenue), 0)::numeric AS revenue
       FROM service_revenue_lines
       GROUP BY service_key, service_name, category
       ORDER BY revenue DESC, booking_count DESC, service_name ASC`,
      [salonId, range.start.toISOString(), range.end.toISOString()],
    );

    const totalRevenue = rows.reduce((sum, row) => sum + parseFloat(row.revenue ?? "0"), 0);
    const totalBookings = rows.reduce((sum, row) => sum + parseInt(row.booking_count ?? "0", 10), 0);

    const normalizedRows = rows.map((row) => {
      const revenue = r1(parseFloat(row.revenue ?? "0"));
      const bookingCount = parseInt(row.booking_count ?? "0", 10);
      const avgValue = bookingCount > 0 ? r1(revenue / bookingCount) : 0;
      const revenueShare = totalRevenue > 0 ? r1((revenue / totalRevenue) * 100) : 0;

      return {
        serviceId: row.service_id,
        serviceName: row.service_name,
        category: row.category,
        bookingCount,
        revenue,
        avgValue,
        revenueShare,
      };
    });

    return {
      summary: {
        totalRevenue: r1(totalRevenue),
        totalBookings,
        totalServices: normalizedRows.length,
        averageServiceValue: totalBookings > 0 ? r1(totalRevenue / totalBookings) : 0,
      },
      rows: normalizedRows,
    };
  },

  // ── Revenue by Service Category ───────────────────────────────────────────────
  async getRevenueByServiceDetail(
    salonId: string,
    serviceId: string,
    startDate: string,
    endDate: string,
    branchId?: string,
    staffId?: string,
  ): Promise<import("./reports.types").RevenueByServiceDetailReport> {
    const range = resolveRevenueDateRange("custom", startDate, endDate);

    const appointmentPaidPredicate = `
      EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.appointment_id = a.id
          AND p.status = 'completed'
      )
    `;

    const serviceRevenueCte = `
      WITH service_revenue_lines AS (
        SELECT
          COALESCE(srv.id::text, si.item_id::text, si.name) AS service_id,
          COALESCE(NULLIF(si.name, ''), srv.name, 'Service') AS service_name,
          COALESCE(cat.name, 'Uncategorized') AS category,
          COALESCE(si.quantity, 1)::int AS booking_count,
          COALESCE(si.total_price, 0)::numeric AS amount,
          COALESCE(a.scheduled_at, sl.created_at) AS appointment_at,
          COALESCE(
            NULLIF(TRIM(COALESCE(c.full_name, '')), ''),
            NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
            'Walk-in Client'
          ) AS client_name,
          TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')) AS staff_name,
          COALESCE(a.duration_minutes, 0)::int AS duration,
          COALESCE(a.status::text, 'completed') AS status,
          CASE
            WHEN a.id IS NULL THEN 'paid'
            WHEN pay.completed_count > 0 THEN 'paid'
            WHEN pay.partial_count > 0 THEN 'partial'
            ELSE 'unpaid'
          END AS payment_status,
          COALESCE(NULLIF(sl.payment_method::text, ''), NULLIF(pay.payment_method, ''), '') AS payment_method,
          a.branch_id::text AS branch_id
        FROM sale_items si
        JOIN sales sl ON sl.id = si.sale_id
        LEFT JOIN appointments a ON a.id = sl.appointment_id
        LEFT JOIN clients c ON c.id = COALESCE(sl.client_id, a.client_id)
        LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, sl.staff_id, a.staff_id)
        LEFT JOIN services srv ON (
          srv.id::text = si.item_id::text
          OR (si.item_id IS NULL AND lower(srv.name) = lower(NULLIF(si.name, '')))
        )
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE p.status = 'completed')::int AS completed_count,
            COUNT(*) FILTER (WHERE p.status = 'partial')::int AS partial_count,
            MAX(NULLIF(p.payment_method, '')) AS payment_method
          FROM payments p
          WHERE p.appointment_id = a.id
        ) pay ON true
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
          AND si.item_type = 'service'
          AND sl.created_at >= $2
          AND sl.created_at < $3

        UNION ALL

        SELECT
          COALESCE(item->>'service_id', srv.id::text, item->>'name', a.id::text) AS service_id,
          COALESCE(NULLIF(item->>'name', ''), srv.name, a.title, 'Service') AS service_name,
          COALESCE(cat.name, 'Uncategorized') AS category,
          COALESCE((item->>'quantity')::int, 1) AS booking_count,
          (COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1))::numeric AS amount,
          a.scheduled_at AS appointment_at,
          COALESCE(
            NULLIF(TRIM(COALESCE(c.full_name, '')), ''),
            NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
            'Walk-in Client'
          ) AS client_name,
          TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')) AS staff_name,
          COALESCE(a.duration_minutes, 0)::int AS duration,
          a.status::text AS status,
          CASE
            WHEN pay.completed_count > 0 THEN 'paid'
            WHEN pay.partial_count > 0 THEN 'partial'
            ELSE 'unpaid'
          END AS payment_status,
          COALESCE(NULLIF(pay.payment_method, ''), '') AS payment_method,
          a.branch_id::text AS branch_id
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
        ) AS item
        LEFT JOIN clients c ON c.id = a.client_id
        LEFT JOIN staff st ON st.id = a.staff_id
        LEFT JOIN services srv ON (
          srv.id::text = (item->>'service_id')
          OR ((item->>'service_id') IS NULL OR trim(item->>'service_id') = '')
             AND lower(srv.name) = lower(NULLIF(item->>'name', ''))
        )
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE p.status = 'completed')::int AS completed_count,
            COUNT(*) FILTER (WHERE p.status = 'partial')::int AS partial_count,
            MAX(NULLIF(p.payment_method, '')) AS payment_method
          FROM payments p
          WHERE p.appointment_id = a.id
        ) pay ON true
        WHERE a.salon_id = $1
          AND a.status = 'completed'
          AND ${appointmentPaidPredicate}
          AND a.scheduled_at >= $2
          AND a.scheduled_at < $3
          AND NOT EXISTS (
            SELECT 1
            FROM sales sl
            WHERE sl.appointment_id = a.id
              AND sl.status = 'completed'
          )
      )
    `;

    const branchFilter = branchId ? `AND COALESCE(branch_id, '') = $5` : "";
    const staffFilter = staffId
      ? `AND COALESCE(NULLIF(TRIM(staff_name), ''), '') = $${branchId ? 6 : 5}`
      : "";
    const totalRevenueBranchFilter = branchId ? `AND COALESCE(branch_id, '') = $4` : "";
    const totalRevenueStaffFilter = staffId
      ? `AND COALESCE(NULLIF(TRIM(staff_name), ''), '') = $${branchId ? 5 : 4}`
      : "";
    const detailParams: any[] = [salonId, range.start.toISOString(), range.end.toISOString(), serviceId];
    if (branchId) detailParams.push(branchId);
    if (staffId) detailParams.push(staffId);

    const totalRevenueParams: any[] = [salonId, range.start.toISOString(), range.end.toISOString()];
    if (branchId) totalRevenueParams.push(branchId);
    if (staffId) totalRevenueParams.push(staffId);

    const totalRevenueResult = await pool.query<{ total_revenue: string }>(
      `${serviceRevenueCte}
       SELECT COALESCE(SUM(amount), 0)::numeric AS total_revenue
       FROM service_revenue_lines
       WHERE 1=1 ${totalRevenueBranchFilter} ${totalRevenueStaffFilter}`,
      totalRevenueParams,
    );

    const { rows } = await pool.query<{
      service_name: string;
      category: string;
      booking_count: string;
      total_revenue: string;
      top_staff: string | null;
      top_client: string | null;
      appointment_date: string;
      client_name: string | null;
      staff_name: string | null;
      duration: string;
      amount: string;
      status: string;
      payment_status: string;
      payment_method: string | null;
    }>(
      `${serviceRevenueCte}
       , filtered_service_lines AS (
         SELECT *
         FROM service_revenue_lines
         WHERE service_id = $4
         ${branchFilter}
         ${staffFilter}
       ),
       staff_rank AS (
         SELECT COALESCE(staff_name, '') AS staff_name, SUM(amount) AS total_amount
         FROM filtered_service_lines
         GROUP BY COALESCE(staff_name, '')
         ORDER BY total_amount DESC, staff_name ASC
         LIMIT 1
       ),
       client_rank AS (
         SELECT COALESCE(client_name, '') AS client_name, SUM(amount) AS total_amount
         FROM filtered_service_lines
         GROUP BY COALESCE(client_name, '')
         ORDER BY total_amount DESC, client_name ASC
         LIMIT 1
       ),
       summary_row AS (
         SELECT
           COALESCE(MAX(service_name), 'Service') AS service_name,
           COALESCE(MAX(category), 'Uncategorized') AS category,
           COALESCE(SUM(booking_count), 0)::int AS booking_count,
           COALESCE(SUM(amount), 0)::numeric AS total_revenue,
           (SELECT staff_name FROM staff_rank) AS top_staff,
           (SELECT client_name FROM client_rank) AS top_client
         FROM filtered_service_lines
       )
       SELECT
         sr.service_name,
         sr.category,
         sr.booking_count,
         sr.total_revenue,
         sr.top_staff,
         sr.top_client,
         TO_CHAR(fsl.appointment_at, 'YYYY-MM-DD') AS appointment_date,
         COALESCE(fsl.client_name, '') AS client_name,
         COALESCE(fsl.staff_name, '') AS staff_name,
         COALESCE(fsl.duration, 0)::int AS duration,
         COALESCE(fsl.amount, 0)::numeric AS amount,
         CASE
           WHEN LOWER(COALESCE(fsl.status, 'completed')) = 'completed' THEN 'Completed'
           WHEN LOWER(COALESCE(fsl.status, '')) = 'cancelled' THEN 'Cancelled'
           WHEN LOWER(COALESCE(fsl.status, '')) = 'no_show' THEN 'No Show'
           ELSE INITCAP(COALESCE(fsl.status, 'completed'))
         END AS status,
         CASE
           WHEN LOWER(COALESCE(fsl.payment_status, '')) IN ('paid', 'completed') THEN 'Paid'
           WHEN LOWER(COALESCE(fsl.payment_status, '')) = 'partial' THEN 'Partial'
           WHEN LOWER(COALESCE(fsl.payment_status, '')) = 'unpaid' THEN 'Unpaid'
           ELSE INITCAP(COALESCE(fsl.payment_status, 'Unpaid'))
         END AS payment_status,
         CASE
           WHEN COALESCE(fsl.payment_method, '') = '' THEN ''
           ELSE UPPER(fsl.payment_method)
         END AS payment_method
       FROM filtered_service_lines fsl
       CROSS JOIN summary_row sr
       ORDER BY fsl.appointment_at DESC, fsl.client_name ASC`,
      detailParams,
    );

    const totalRevenueAllServices = parseFloat(totalRevenueResult.rows[0]?.total_revenue ?? "0") || 0;
    const summaryRow = rows[0];
    const bookingCount = parseInt(summaryRow?.booking_count ?? "0", 10) || 0;
    const totalRevenue = parseFloat(summaryRow?.total_revenue ?? "0") || 0;

    return {
      summary: {
        serviceName: summaryRow?.service_name ?? "Service",
        category: summaryRow?.category ?? "Uncategorized",
        bookingCount,
        totalRevenue: r1(totalRevenue),
        averageValue: bookingCount > 0 ? r1(totalRevenue / bookingCount) : 0,
        revenuePercentage: totalRevenueAllServices > 0 ? r1((totalRevenue / totalRevenueAllServices) * 100) : 0,
        topStaff: summaryRow?.top_staff ?? "",
        topClient: summaryRow?.top_client ?? "",
      },
      details: rows.map((row) => ({
        appointmentDate: row.appointment_date,
        clientName: row.client_name ?? "",
        staffName: row.staff_name ?? "",
        duration: parseInt(row.duration ?? "0", 10) || 0,
        amount: r1(parseFloat(row.amount ?? "0") || 0),
        status: row.status,
        paymentStatus: row.payment_status,
        paymentMethod: row.payment_method ?? "",
      })),
      appointments: rows.map((row) => ({
        appointmentDate: row.appointment_date,
        clientName: row.client_name ?? "",
        staffName: row.staff_name ?? "",
        duration: parseInt(row.duration ?? "0", 10) || 0,
        amount: r1(parseFloat(row.amount ?? "0") || 0),
        status: row.status,
        paymentStatus: row.payment_status,
        paymentMethod: row.payment_method ?? "",
      })),
    };
  },

  async getRevenueByServiceCategory(
    salonId: string,
    period: ReportPeriod,
    from?: string,
    to?: string,
    categoryId?: string,
    branchId?: string,
    staffId?: string,
    search?: string,
    sortBy?: string,
  ): Promise<import('./reports.types').RevenueByServiceCategoryReport> {
    const range = resolveRevenueDateRange(period, from, to);

    const appointmentPaidPredicate = `
      EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.appointment_id = a.id
          AND p.status = 'completed'
      )
    `;

    const salesFilters: string[] = [];
    const appointmentFilters: string[] = [];
    const categoryFilters: string[] = [];
    const params: any[] = [salonId, range.start.toISOString(), range.end.toISOString()];
    let paramIndex = 4;

    if (categoryId) {
      salesFilters.push(`AND cat.id::text = $${paramIndex}`);
      appointmentFilters.push(`AND cat.id::text = $${paramIndex}`);
      categoryFilters.push(`AND sc.id::text = $${paramIndex}`);
      params.push(categoryId);
      paramIndex += 1;
    }

    if (branchId) {
      salesFilters.push(`AND a.branch_id::text = $${paramIndex}`);
      appointmentFilters.push(`AND a.branch_id::text = $${paramIndex}`);
      params.push(branchId);
      paramIndex += 1;
    }

    if (staffId) {
      salesFilters.push(`AND COALESCE(si.staff_id, sl.staff_id, a.staff_id)::text = $${paramIndex}`);
      appointmentFilters.push(`AND a.staff_id::text = $${paramIndex}`);
      params.push(staffId);
      paramIndex += 1;
    }

    if (search) {
      salesFilters.push(`AND cat.name ILIKE $${paramIndex}`);
      appointmentFilters.push(`AND cat.name ILIKE $${paramIndex}`);
      categoryFilters.push(`AND sc.name ILIKE $${paramIndex}`);
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    const serviceRevenueCte = `
      WITH active_category_services AS (
        SELECT
          COALESCE(sc.id::text, 'uncategorized') AS category_id,
          COALESCE(sc.name, 'Uncategorized') AS category_name,
          COUNT(*)::int AS services_count
        FROM services srv
        LEFT JOIN service_categories sc ON sc.id = srv.category_id
        WHERE srv.salon_id = $1
          AND srv.is_active = true
          ${categoryFilters.join("\n          ")}
        GROUP BY COALESCE(sc.id::text, 'uncategorized'), COALESCE(sc.name, 'Uncategorized')
      ),
      service_revenue_lines AS (
        SELECT
          COALESCE(cat.id::text, 'uncategorized') AS category_id,
          COALESCE(cat.name, 'Uncategorized') AS category_name,
          COALESCE(srv.id::text, si.item_id::text) AS service_id,
          COALESCE(NULLIF(si.name, ''), srv.name, 'Service') AS service_name,
          COALESCE(si.quantity, 1)::int AS booking_count,
          COALESCE(si.total_price, 0)::numeric AS revenue
        FROM sale_items si
        JOIN sales sl ON sl.id = si.sale_id
        LEFT JOIN services srv ON srv.id::text = si.item_id::text
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
          AND si.item_type = 'service'
          AND sl.created_at >= $2
          AND sl.created_at < $3
          ${salesFilters.join("\n          ")}

        UNION ALL

        SELECT
          COALESCE(cat.id::text, 'uncategorized') AS category_id,
          COALESCE(cat.name, 'Uncategorized') AS category_name,
          COALESCE(item->>'service_id', a.id::text) AS service_id,
          COALESCE(NULLIF(item->>'name', ''), srv.name, a.title, 'Service') AS service_name,
          COALESCE((item->>'quantity')::int, 1) AS booking_count,
          (COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1))::numeric AS revenue
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
        ) AS item
        LEFT JOIN services srv ON srv.id::text = (item->>'service_id')
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        WHERE a.salon_id = $1
          AND a.status = 'completed'
          AND ${appointmentPaidPredicate}
          AND a.scheduled_at >= $2
          AND a.scheduled_at < $3
          ${appointmentFilters.join("\n          ")}
          AND NOT EXISTS (
            SELECT 1
            FROM sales sl
            WHERE sl.appointment_id = a.id
              AND sl.status = 'completed'
          )
      )
    `;

    const orderByMap: Record<string, string> = {
      "highest_revenue": "revenue DESC, booking_count DESC",
      "lowest_revenue": "revenue ASC, booking_count ASC",
      "most_booked": "booking_count DESC, revenue DESC",
      "least_booked": "booking_count ASC, revenue DESC",
      "highest_avg_revenue": "avg_revenue DESC, booking_count DESC",
      "lowest_avg_revenue": "avg_revenue ASC, booking_count DESC",
    };
    const orderBy = orderByMap[sortBy ?? "highest_revenue"] || "revenue DESC, booking_count DESC";

    const { rows } = await pool.query<{
      category_id: string;
      category_name: string;
      services_count: string;
      booking_count: string;
      revenue: string;
      avg_value: string;
    }>(
      `${serviceRevenueCte}
       SELECT
         COALESCE(cat.category_id, acs.category_id) AS category_id,
         COALESCE(cat.category_name, acs.category_name) AS category_name,
         COALESCE(acs.services_count, 0)::int AS services_count,
         COALESCE(SUM(cat.booking_count), 0)::int AS booking_count,
         COALESCE(SUM(cat.revenue), 0)::numeric AS revenue,
         COALESCE(SUM(cat.revenue), 0)::numeric / NULLIF(COALESCE(SUM(cat.booking_count), 0), 0) AS avg_value
       FROM active_category_services acs
       FULL OUTER JOIN service_revenue_lines cat
         ON cat.category_id = acs.category_id
       GROUP BY
         COALESCE(cat.category_id, acs.category_id),
         COALESCE(cat.category_name, acs.category_name),
         COALESCE(acs.services_count, 0)
       ORDER BY ${orderBy}`,
      params,
    );

    const totalRevenue = rows.reduce((sum, row) => sum + parseFloat(row.revenue ?? "0"), 0);
    const totalBookings = rows.reduce((sum, row) => sum + parseInt(row.booking_count ?? "0", 10), 0);
    const topRevenueCategory = rows[0]?.category_name ?? "N/A";

    const normalizedRows = rows.map((row) => {
      const revenue = r1(parseFloat(row.revenue ?? "0"));
      const bookingCount = parseInt(row.booking_count ?? "0", 10);
      const avgValue = bookingCount > 0 ? r1(revenue / bookingCount) : 0;
      const revenuePercentage = totalRevenue > 0 ? r1((revenue / totalRevenue) * 100) : 0;

      return {
        categoryId: row.category_id,
        categoryName: row.category_name,
        servicesCount: parseInt(row.services_count ?? "0", 10),
        serviceCount: parseInt(row.services_count ?? "0", 10),
        bookingCount,
        revenue,
        avgValue,
        avgRevenuePerBooking: avgValue,
        revenuePercentage,
      };
    });

    return {
      summary: {
        totalCategories: normalizedRows.length,
        totalRevenue: r1(totalRevenue),
        totalBookings,
        topRevenueCategory,
        topCategory: topRevenueCategory,
      },
      tableData: normalizedRows,
      rows: normalizedRows,
    };
  },

  // ── Revenue by Service Category: Detail ───────────────────────────────────────
  async getRevenueByServiceCategoryDetail(
    salonId: string,
    categoryId: string,
    period: ReportPeriod,
    from?: string,
    to?: string,
    branchId?: string,
    staffId?: string,
  ): Promise<import('./reports.types').RevenueByServiceCategoryDetailReport> {
    const range = resolveRevenueDateRange(period, from, to);

    const appointmentPaidPredicate = `
      EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.appointment_id = a.id
          AND p.status = 'completed'
      )
    `;

    const params: any[] = [salonId, range.start.toISOString(), range.end.toISOString(), categoryId];
    let paramIndex = 5;
    const salesFilters: string[] = [];
    const appointmentFilters: string[] = [];

    if (branchId) {
      salesFilters.push(`AND a.branch_id::text = $${paramIndex}`);
      appointmentFilters.push(`AND a.branch_id::text = $${paramIndex}`);
      params.push(branchId);
      paramIndex += 1;
    }

    if (staffId) {
      salesFilters.push(`AND COALESCE(si.staff_id, sl.staff_id, a.staff_id)::text = $${paramIndex}`);
      appointmentFilters.push(`AND a.staff_id::text = $${paramIndex}`);
      params.push(staffId);
      paramIndex += 1;
    }

    const serviceRevenueCte = `
      WITH service_revenue_lines AS (
        SELECT
          COALESCE(srv.id::text, si.item_id::text) AS service_id,
          COALESCE(NULLIF(si.name, ''), srv.name, 'Service') AS service_name,
          COALESCE(si.quantity, 1)::int AS booking_count,
          COALESCE(si.total_price, 0)::numeric AS revenue
        FROM sale_items si
        JOIN sales sl ON sl.id = si.sale_id
        LEFT JOIN services srv ON srv.id::text = si.item_id::text
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
          AND si.item_type = 'service'
          AND sl.created_at >= $2
          AND sl.created_at < $3
          AND cat.id::text = $4
          ${salesFilters.join("\n          ")}

        UNION ALL

        SELECT
          COALESCE(item->>'service_id', a.id::text) AS service_id,
          COALESCE(NULLIF(item->>'name', ''), srv.name, a.title, 'Service') AS service_name,
          COALESCE((item->>'quantity')::int, 1) AS booking_count,
          (COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1))::numeric AS revenue
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
        ) AS item
        LEFT JOIN services srv ON srv.id::text = (item->>'service_id')
        LEFT JOIN service_categories cat ON cat.id = srv.category_id
        WHERE a.salon_id = $1
          AND a.status = 'completed'
          AND ${appointmentPaidPredicate}
          AND a.scheduled_at >= $2
          AND a.scheduled_at < $3
          AND cat.id::text = $4
          ${appointmentFilters.join("\n          ")}
          AND NOT EXISTS (
            SELECT 1
            FROM sales sl
            WHERE sl.appointment_id = a.id
              AND sl.status = 'completed'
          )
      )
    `;

    // Get category name
    const categoryResult = await pool.query<{ name: string }>(
      `SELECT name FROM service_categories WHERE id = $1 AND salon_id = $2`,
      [categoryId, salonId],
    );

    const categoryName = categoryResult.rows[0]?.name ?? "Unknown Category";

    // Get services in the category
    const { rows } = await pool.query<{
      service_id: string;
      service_name: string;
      booking_count: string;
      revenue: string;
    }>(
      `${serviceRevenueCte}
       SELECT
         service_id,
         service_name,
         COALESCE(SUM(booking_count), 0)::int AS booking_count,
         COALESCE(SUM(revenue), 0)::numeric AS revenue
       FROM service_revenue_lines
       GROUP BY service_id, service_name
       ORDER BY revenue DESC, booking_count DESC`,
      params,
    );

    const categoryRevenue = rows.reduce((sum, row) => sum + parseFloat(row.revenue ?? "0"), 0);
    const services = rows.map((row) => {
      const revenue = r1(parseFloat(row.revenue ?? "0"));
      const bookingCount = parseInt(row.booking_count ?? "0", 10);
      const avgValue = bookingCount > 0 ? r1(revenue / bookingCount) : 0;

      return {
        serviceId: row.service_id,
        serviceName: row.service_name,
        bookingCount,
        revenue,
        avgValue,
        categoryRevenuePercentage: categoryRevenue > 0 ? r1((revenue / categoryRevenue) * 100) : 0,
      };
    });

    return {
      categoryName,
      services,
    };
  },

  // ── Appointments ─────────────────────────────────────────────────────────────
  async getAppointments(
    salonId: string,
    query: NormalizedAppointmentAnalyticsQuery,
  ): Promise<AppointmentsReport> {
    const range = resolveRevenueDateRange(query.period, query.from, query.to);
    const appointmentSourceExists = await hasAppointmentSourceColumn();
    const params: Array<string> = [salonId, range.start.toISOString(), range.end.toISOString()];
    let paramIndex = params.length + 1;
    const filters: string[] = [
      "a.salon_id = $1",
      "a.scheduled_at >= $2::timestamptz",
      "a.scheduled_at < $3::timestamptz",
      "COALESCE(a.status::text, '') <> 'deleted'",
    ];

    if (query.staffId) {
      filters.push(`a.staff_id = $${paramIndex}`);
      params.push(query.staffId);
      paramIndex += 1;
    }

    if (query.branchId) {
      filters.push(`a.branch_id = $${paramIndex}`);
      params.push(query.branchId);
      paramIndex += 1;
    }

    if (query.serviceId) {
      filters.push(`(
        a.service_id = $${paramIndex}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END) AS item
          WHERE item->>'service_id' = $${paramIndex}
        )
      )`);
      params.push(query.serviceId);
      paramIndex += 1;
    }

    const searchFilter = query.search
      ? `AND (
          COALESCE(c.full_name, TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) ILIKE $${paramIndex}
          OR TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) ILIKE $${paramIndex}
          OR COALESCE(service_names.service_name, a.title, 'Service') ILIKE $${paramIndex}
        )`
      : "";
    if (query.search) {
      params.push(`%${query.search}%`);
      paramIndex += 1;
    }

    const sortMap: Record<NormalizedAppointmentAnalyticsQuery["sortBy"], string> = {
      appointmentDate: "scheduled_at",
      amount: "CASE WHEN status = 'completed' THEN COALESCE(sale_amount, 0) ELSE 0 END",
      status: "status",
    };
    const sortColumn = sortMap[query.sortBy];
    const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const sourceExpr = appointmentSourceExists
      ? `CASE
           WHEN LOWER(COALESCE(a.source, '')) IN ('walk_in', 'walk-in') THEN 'Walk-in'
           WHEN LOWER(COALESCE(a.source, '')) IN ('online', 'website', 'web') THEN 'Online'
           WHEN LOWER(COALESCE(a.source, '')) = 'phone' THEN 'Phone'
           WHEN LOWER(COALESCE(a.source, '')) = 'whatsapp' THEN 'WhatsApp'
           WHEN LOWER(COALESCE(a.source, '')) IN ('app', 'mobile_app', 'mobile app') THEN 'Mobile App'
           WHEN COALESCE(a.source, '') = '' THEN 'Unknown'
           ELSE a.source
         END`
      : `'Unknown'`;

    const baseCte = `
      WITH filtered_appointments AS (
        SELECT
          a.id,
          a.client_id,
          a.staff_id,
          a.branch_id,
          a.service_id,
          a.title,
          a.status::text AS status,
          a.payment_status::text AS payment_status,
          a.scheduled_at,
          a.created_at,
          a.duration_minutes,
          ${sourceExpr} AS booking_source,
          COALESCE(c.full_name,
            TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
          ) AS client_name,
          TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) AS staff_name,
          COALESCE(service_names.service_name, a.title, 'Service') AS service_name,
          COALESCE(s.total_amount, 0)::numeric AS sale_amount,
          COALESCE(s.payment_method, '') AS payment_method
        FROM appointments a
        LEFT JOIN clients c ON c.id = a.client_id
        LEFT JOIN staff st ON st.id = a.staff_id
        LEFT JOIN LATERAL (
          SELECT STRING_AGG(DISTINCT COALESCE(NULLIF(item->>'name', ''), srv.name, 'Service'), ', ') AS service_name
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END) AS item
          LEFT JOIN services srv ON srv.id::text = item->>'service_id'
        ) service_names ON true
        LEFT JOIN sales s ON s.appointment_id = a.id AND s.status = 'completed'
        WHERE ${filters.join(" AND ")}
        ${searchFilter}
      )`;

    const [summaryRows, volumeRows, peakRows, sourceRows, trendRows, topServiceRows, tableRows] = await Promise.all([
      pool.query<{
        total_appointments: string;
        completed_appointments: string;
        cancelled_appointments: string;
        no_show_appointments: string;
      }>(
        `${baseCte}
         SELECT
           COUNT(*)::int AS total_appointments,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_appointments,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_appointments,
           COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show_appointments
         FROM filtered_appointments`,
        params,
      ),
      pool.query<{ label: string; completed: string; cancelled: string; no_show: string }>(
        `${baseCte}
         SELECT
           TO_CHAR(DATE(scheduled_at), 'YYYY-MM-DD') AS label,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
           COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show
         FROM filtered_appointments
         GROUP BY DATE(scheduled_at), TO_CHAR(DATE(scheduled_at), 'YYYY-MM-DD')
         ORDER BY DATE(scheduled_at) ASC`,
        params,
      ),
      pool.query<{ hour_label: string; count: string }>(
        `${baseCte}
         SELECT
           TO_CHAR(DATE_TRUNC('hour', scheduled_at), 'HH12:MI AM') AS hour_label,
           COUNT(*)::int AS count
         FROM filtered_appointments
         GROUP BY DATE_TRUNC('hour', scheduled_at), TO_CHAR(DATE_TRUNC('hour', scheduled_at), 'HH12:MI AM')
         ORDER BY count DESC, DATE_TRUNC('hour', scheduled_at) ASC`,
        params,
      ),
      pool.query<{ source: string; count: string }>(
        `${baseCte}
         SELECT booking_source AS source, COUNT(*)::int AS count
         FROM filtered_appointments
         GROUP BY booking_source
         ORDER BY count DESC, booking_source ASC`,
        params,
      ),
      pool.query<{ period: string; appointments: string }>(
        `${baseCte}
         SELECT
           TO_CHAR(DATE(scheduled_at), 'YYYY-MM-DD') AS period,
           COUNT(*)::int AS appointments
         FROM filtered_appointments
         GROUP BY DATE(scheduled_at), TO_CHAR(DATE(scheduled_at), 'YYYY-MM-DD')
         ORDER BY DATE(scheduled_at) ASC`,
        params,
      ),
      pool.query<{ service_name: string; booking_count: string }>(
        `${baseCte}
         SELECT
           service_name,
           COUNT(*)::int AS booking_count
         FROM filtered_appointments
         GROUP BY service_name
         ORDER BY booking_count DESC, service_name ASC
         LIMIT 10`,
        params,
      ),
      pool.query<{
        appointment_date: string;
        appointment_time: string;
        booked_date: string;
        client_name: string;
        service_name: string;
        staff_name: string;
        status: string;
        duration: string;
        amount: string;
        payment_method: string;
        payment_status: string;
      }>(
        `${baseCte}
         SELECT
           TO_CHAR(scheduled_at, 'YYYY-MM-DD') AS appointment_date,
           TO_CHAR(scheduled_at, 'HH12:MI AM') AS appointment_time,
           TO_CHAR(created_at, 'YYYY-MM-DD') AS booked_date,
           COALESCE(client_name, '') AS client_name,
           COALESCE(service_name, 'Service') AS service_name,
           COALESCE(staff_name, '') AS staff_name,
           status,
           COALESCE(duration_minutes, 0)::int AS duration,
           CASE WHEN status = 'completed' THEN COALESCE(sale_amount, 0) ELSE 0 END::numeric AS amount,
           COALESCE(payment_method, '') AS payment_method,
           COALESCE(payment_status, 'unpaid') AS payment_status
         FROM filtered_appointments a
         ORDER BY ${sortColumn} ${sortOrder}
         LIMIT 500`,
        params,
      ),
    ]);

    const summary = summaryRows.rows[0];
    const totalAppointments = parseInt(summary?.total_appointments ?? "0", 10) || 0;
    const completedAppointments = parseInt(summary?.completed_appointments ?? "0", 10) || 0;
    const cancelledAppointments = parseInt(summary?.cancelled_appointments ?? "0", 10) || 0;
    const noShowAppointments = parseInt(summary?.no_show_appointments ?? "0", 10) || 0;

    const bookingSourceMap = new Map(sourceRows.rows.map((row) => [row.source, parseInt(row.count, 10) || 0]));
    const bookingSources = ["Walk-in", "Online", "Phone", "WhatsApp", "Mobile App"].map((source) => ({
      source,
      count: bookingSourceMap.get(source) ?? 0,
    }));

    return {
      summary: {
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        cancellationRate: totalAppointments > 0 ? r1((cancelledAppointments / totalAppointments) * 100) : 0,
        noShowRate: totalAppointments > 0 ? r1((noShowAppointments / totalAppointments) * 100) : 0,
      },
      appointmentVolume: volumeRows.rows.map((row) => ({
        label: row.label,
        completed: parseInt(row.completed ?? "0", 10) || 0,
        cancelled: parseInt(row.cancelled ?? "0", 10) || 0,
        noShow: parseInt(row.no_show ?? "0", 10) || 0,
      })),
      peakHours: peakRows.rows.map((row) => ({
        hour: row.hour_label,
        count: parseInt(row.count ?? "0", 10) || 0,
      })),
      bookingSources,
      appointmentTrend: trendRows.rows.map((row) => ({
        period: row.period,
        appointments: parseInt(row.appointments ?? "0", 10) || 0,
      })),
      topServices: topServiceRows.rows.map((row) => ({
        serviceName: row.service_name,
        bookingCount: parseInt(row.booking_count ?? "0", 10) || 0,
      })),
      tableData: tableRows.rows.map((row) => ({
        appointmentDate: row.appointment_date,
        appointmentTime: row.appointment_time,
        bookedDate: row.booked_date,
        clientName: row.client_name ?? "",
        serviceName: row.service_name ?? "Service",
        staffName: row.staff_name ?? "",
        status: row.status,
        duration: parseInt(row.duration ?? "0", 10) || 0,
        amount: parseFloat(row.amount ?? "0") || 0,
        paymentMethod: row.payment_method ?? "",
        paymentStatus: row.payment_status ?? "unpaid",
      })),
    };
  },

  // ── Clients ──────────────────────────────────────────────────────────────────
  async getClients(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<ClientsReport> {
    const { startExpr, endExpr, prevStart, prevEnd, trunc, labelFmt, extraParams } =
      buildDateExprs(period, from, to);
    const p = [salonId, ...extraParams];

    const [growthRows, topRows, kpiRows, prevKpiRows] = await Promise.all([
      pool.query<{ label: string; new_clients: string; returning_clients: string }>(
        `WITH first_visits AS (
           SELECT client_id, MIN(scheduled_at) AS first_visit
           FROM appointments
           WHERE salon_id = $1 AND client_id IS NOT NULL
           GROUP BY client_id
         ),
         period_visits AS (
           SELECT
             a.client_id,
             DATE_TRUNC('${trunc}', a.scheduled_at) AS bucket,
             fv.first_visit
           FROM appointments a
           JOIN first_visits fv ON fv.client_id = a.client_id
           WHERE a.salon_id = $1
             AND a.client_id IS NOT NULL
             AND a.status NOT IN ('cancelled','no_show')
             AND a.scheduled_at >= ${startExpr}
             AND a.scheduled_at <  ${endExpr}
         )
         SELECT
           TO_CHAR(bucket, '${labelFmt}')                                                     AS label,
           COUNT(DISTINCT CASE WHEN first_visit >= ${startExpr} THEN client_id END)::int AS new_clients,
           COUNT(DISTINCT CASE WHEN first_visit <  ${startExpr} THEN client_id END)::int AS returning_clients
         FROM period_visits
         GROUP BY bucket, TO_CHAR(bucket, '${labelFmt}')
         ORDER BY bucket ASC`,
        p,
      ),
      pool.query<{ id: string; name: string; visits: string; spend: string }>(
        `SELECT
           c.id,
           COALESCE(c.full_name,
             TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
           )                                              AS name,
           COUNT(DISTINCT a.id)::int                     AS visits,
           COALESCE(SUM(s.total_amount), 0)::numeric     AS spend
         FROM clients c
         JOIN appointments a
           ON a.client_id = c.id AND a.salon_id = $1
           AND a.scheduled_at >= ${startExpr} AND a.scheduled_at < ${endExpr}
           AND a.status = 'completed'
         LEFT JOIN sales s
           ON s.client_id = c.id AND s.salon_id = $1
           AND s.created_at >= ${startExpr} AND s.created_at < ${endExpr}
           AND s.status = 'completed'
         WHERE c.is_active = true
         GROUP BY c.id, c.full_name, c.first_name, c.last_name
         ORDER BY spend DESC
         LIMIT 10`,
        p,
      ),
      pool.query<{ total: string; new_clients: string; returning_clients: string }>(
        `WITH all_clients AS (
           SELECT DISTINCT client_id FROM appointments
           WHERE salon_id = $1 AND client_id IS NOT NULL
             AND status NOT IN ('cancelled','no_show')
           UNION
           SELECT DISTINCT client_id FROM sales
           WHERE salon_id = $1 AND client_id IS NOT NULL AND status = 'completed'
         ),
         first_visits AS (
           SELECT client_id, MIN(scheduled_at) AS first_visit
           FROM appointments WHERE salon_id = $1 AND client_id IS NOT NULL
           GROUP BY client_id
         )
         SELECT
           COUNT(DISTINCT ac.client_id)::int AS total,
           COUNT(DISTINCT CASE WHEN fv.first_visit >= ${startExpr}
                               THEN ac.client_id END)::int AS new_clients,
           COUNT(DISTINCT CASE WHEN fv.first_visit <  ${startExpr}
                               THEN ac.client_id END)::int AS returning_clients
         FROM all_clients ac
         LEFT JOIN first_visits fv ON fv.client_id = ac.client_id`,
        p,
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(DISTINCT client_id)::int AS total
         FROM appointments
         WHERE salon_id = $1
           AND client_id IS NOT NULL
           AND status NOT IN ('cancelled','no_show')
           AND scheduled_at >= ${prevStart}
           AND scheduled_at <  ${prevEnd}`,
        p,
      ),
    ]);

    const growth: ClientGrowthPoint[] = growthRows.rows.map(row => ({
      label:     row.label.trim(),
      new:       parseInt(row.new_clients,       10),
      returning: parseInt(row.returning_clients, 10),
      churned:   0,
    }));

    const topClients = topRows.rows.map(row => ({
      id:     row.id,
      name:   row.name || "Unknown",
      visits: parseInt(row.visits, 10),
      spend:  parseFloat(row.spend),
    }));

    const k  = kpiRows.rows[0];
    const pk = prevKpiRows.rows[0];

    const totalClients    = parseInt(k?.total             ?? "0", 10);
    const newThisMonth    = parseInt(k?.new_clients       ?? "0", 10);
    const returningCount  = parseInt(k?.returning_clients ?? "0", 10);
    const prevTotal       = parseInt(pk?.total            ?? "0", 10);

    const retentionRate      = totalClients > 0 ? r1((returningCount / totalClients) * 100) : 0;
    const totalVisits        = growth.reduce((s, g) => s + g.new + g.returning, 0);
    const avgVisitsPerClient = totalClients > 0 ? r1(totalVisits / totalClients) : 0;

    return {
      growth,
      topClients,
      kpi: {
        totalClients,
        newThisMonth,
        retentionRate,
        avgVisitsPerClient,
        changes: {
          totalClients:       pct(totalClients, prevTotal),
          newThisMonth:       0,
          retentionRate:      0,
          avgVisitsPerClient: 0,
        },
      },
    };
  },

  // ── Staff ─────────────────────────────────────────────────────────────────────
  async getStaff(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<StaffReport> {
    const { startExpr, endExpr, prevStart, prevEnd, numDays, extraParams } =
      buildDateExprs(period, from, to);
    const p = [salonId, ...extraParams];

    const [perfRows, prevRevRows] = await Promise.all([
      pool.query<{
        id: string; name: string;
        bookings: string; revenue: string; utilization: string; avg_ticket: string;
      }>(
        `SELECT
           s.id,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS name,
           COUNT(DISTINCT a.id)::int                   AS bookings,
           COALESCE(SUM(sl.total_amount), 0)::numeric  AS revenue,
           LEAST(ROUND(
             COUNT(DISTINCT a.id)::numeric / GREATEST(${numDays}, 1) / 8.0 * 100, 1
           ), 100)                                     AS utilization,
           CASE WHEN COUNT(DISTINCT a.id) > 0
             THEN ROUND(COALESCE(SUM(sl.total_amount),0) / COUNT(DISTINCT a.id), 0)
             ELSE 0 END                                AS avg_ticket
         FROM staff s
         LEFT JOIN appointments a
                ON a.staff_id = s.id AND a.salon_id = $1
               AND a.scheduled_at >= ${startExpr} AND a.scheduled_at < ${endExpr}
               AND a.status = 'completed'
         LEFT JOIN sales sl
                ON sl.staff_id = s.id AND sl.salon_id = $1
               AND sl.created_at >= ${startExpr} AND sl.created_at < ${endExpr}
               AND sl.status = 'completed'
         WHERE s.salon_id = $1 AND s.is_active = true
         GROUP BY s.id, s.first_name, s.last_name
         ORDER BY revenue DESC
         LIMIT 10`,
        p,
      ),
      pool.query<{ id: string; prev_revenue: string }>(
        `SELECT
           s.id,
           COALESCE(SUM(sl.total_amount), 0)::numeric AS prev_revenue
         FROM staff s
         LEFT JOIN sales sl
                ON sl.staff_id = s.id AND sl.salon_id = $1
               AND sl.created_at >= ${prevStart} AND sl.created_at < ${prevEnd}
               AND sl.status = 'completed'
         WHERE s.salon_id = $1 AND s.is_active = true
         GROUP BY s.id`,
        p,
      ),
    ]);

    const prevMap = new Map<string, number>(
      prevRevRows.rows.map(r => [r.id, parseFloat(r.prev_revenue)]),
    );

    const performance: StaffPerformance[] = perfRows.rows.map(row => ({
      id:          row.id,
      name:        row.name || "Unknown",
      bookings:    parseInt(row.bookings,    10),
      revenue:     parseFloat(row.revenue),
      rating:      4.5,
      utilization: parseFloat(row.utilization),
      avgTicket:   parseFloat(row.avg_ticket),
    }));

    const top3        = performance.slice(0, 3);
    const maxBookings = Math.max(...top3.map(s => s.bookings), 1);
    const maxRevenue  = Math.max(...top3.map(s => s.revenue),  1);

    const radar = [
      { metric: "Bookings",   ...Object.fromEntries(top3.map(s => [s.name, Math.round(s.bookings / maxBookings * 100)])) },
      { metric: "Revenue",    ...Object.fromEntries(top3.map(s => [s.name, Math.round(s.revenue  / maxRevenue  * 100)])) },
      { metric: "Rating",     ...Object.fromEntries(top3.map(s => [s.name, Math.round(s.rating   * 20)])) },
      { metric: "Retention",  ...Object.fromEntries(top3.map(s => [s.name, Math.round(s.utilization)])) },
      { metric: "Efficiency", ...Object.fromEntries(top3.map(s => [s.name, Math.round(s.utilization)])) },
    ];

    const activeStaff      = performance.length;
    const avgUtil          = activeStaff > 0 ? r1(performance.reduce((s, x) => s + x.utilization, 0) / activeStaff) : 0;
    const topEarnerRevenue = performance[0]?.revenue ?? 0;
    const avgRating        = r1(performance.reduce((s, x) => s + x.rating, 0) / (activeStaff || 1));
    const prevTopEarner    = performance[0] ? (prevMap.get(performance[0].id) ?? 0) : 0;

    return {
      performance,
      radar,
      kpi: {
        activeStaff,
        avgUtilization:   avgUtil,
        topEarnerRevenue,
        avgRating,
        changes: {
          activeStaff:      0,
          avgUtilization:   0,
          topEarnerRevenue: pct(topEarnerRevenue, prevTopEarner),
          avgRating:        0,
        },
      },
    };
  },

  // ── Services ──────────────────────────────────────────────────────────────────
  async getServices(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<ServicesReport> {
    const { startExpr, endExpr, prevStart, prevEnd, extraParams } =
      buildDateExprs(period, from, to);
    const p = [salonId, ...extraParams];

    const [curRows, prevRows, activeCountRows] = await Promise.all([
      pool.query<{ name: string; bookings: string; revenue: string }>(
        `SELECT
           si.name                                    AS name,
           COUNT(*)::int                              AS bookings,
           COALESCE(SUM(si.total_price), 0)::numeric AS revenue
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         WHERE s.salon_id = $1
           AND s.status   = 'completed'
           AND si.item_type = 'service'
           AND si.name IS NOT NULL AND si.name != ''
           AND s.created_at >= ${startExpr}
           AND s.created_at <  ${endExpr}
         GROUP BY si.name
         ORDER BY revenue DESC
         LIMIT 20`,
        p,
      ),
      pool.query<{ name: string; prev_revenue: string }>(
        `SELECT
           si.name                                    AS name,
           COALESCE(SUM(si.total_price), 0)::numeric AS prev_revenue
         FROM sale_items si
         JOIN sales s ON si.sale_id = s.id
         WHERE s.salon_id = $1
           AND s.status   = 'completed'
           AND si.item_type = 'service'
           AND si.name IS NOT NULL AND si.name != ''
           AND s.created_at >= ${prevStart}
           AND s.created_at <  ${prevEnd}
         GROUP BY si.name`,
        p,
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM services WHERE salon_id = $1 AND is_active = true`,
        [salonId],
      ),
    ]);

    const prevMap = new Map<string, number>(
      prevRows.rows.map(r => [r.name, parseFloat(r.prev_revenue)]),
    );

    const services: ServicePerformance[] = curRows.rows.map(row => {
      const bookings = parseInt(row.bookings, 10);
      const revenue  = parseFloat(row.revenue);
      const prev     = prevMap.get(row.name) ?? 0;
      return {
        name:      row.name,
        bookings,
        revenue,
        avgTicket: bookings > 0 ? Math.round(revenue / bookings) : 0,
        growth:    pct(revenue, prev),
      };
    });

    const totalRevenue   = services.reduce((s, sv) => s + sv.revenue,  0);
    const totalBookings  = services.reduce((s, sv) => s + sv.bookings, 0);
    const topSvcRev      = services[0]?.revenue ?? 0;
    const avgTicket      = totalBookings > 0 ? Math.round(totalRevenue / totalBookings) : 0;
    const activeServices = parseInt(activeCountRows.rows[0]?.count ?? "0", 10);

    return {
      services,
      kpi: {
        activeServices,
        topServiceRevenue: topSvcRev,
        avgTicket,
        newServices: 0,
        changes: { activeServices: 0, topServiceRevenue: 0, avgTicket: 0, newServices: 0 },
      },
    };
  },

  async getEmployeePerformance(
    salonId: string,
    query: NormalizedEmployeePerformanceQuery,
  ): Promise<EmployeePerformanceReport> {
    const {
      from,
      to,
      employeeId,
      role,
      department,
      search,
      sortBy,
      sortOrder,
      page,
      pageSize,
    } = query;

    const [departmentColumnExists, staffSchedulesTableExists] = await Promise.all([
      hasStaffDepartmentColumn(),
      hasStaffSchedulesTable(),
    ]);

    const params: Array<string | number> = [salonId, from, to];
    let paramIndex = params.length + 1;
    const staffFilters: string[] = ["s.salon_id = $1", "s.is_active = true"];

    if (employeeId) {
      staffFilters.push(`s.id = $${paramIndex}`);
      params.push(employeeId);
      paramIndex += 1;
    }

    if (role && role !== "All") {
      staffFilters.push(`COALESCE(s.designation, '') ILIKE $${paramIndex}`);
      params.push(`%${role}%`);
      paramIndex += 1;
    }

    if (department && department !== "All") {
      if (departmentColumnExists) {
        staffFilters.push(`COALESCE(s.department, 'General') ILIKE $${paramIndex}`);
      } else {
        staffFilters.push(`'General' ILIKE $${paramIndex}`);
      }
      params.push(`%${department}%`);
      paramIndex += 1;
    }

    if (search) {
      staffFilters.push(
        `(TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) ILIKE $${paramIndex}
          OR s.id::text ILIKE $${paramIndex})`,
      );
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    const departmentExpr = departmentColumnExists
      ? `COALESCE(NULLIF(s.department, ''), 'General')`
      : `'General'`;

    const workingHoursCte = staffSchedulesTableExists
      ? `,
      schedule_hours AS (
        SELECT
          fs.employee_id,
          COALESCE(SUM(
            CASE
              WHEN sch.is_available = true
                AND sch.start_time IS NOT NULL
                AND sch.end_time IS NOT NULL
                AND sch.end_time > sch.start_time
              THEN EXTRACT(EPOCH FROM (sch.end_time - sch.start_time)) / 3600.0
              ELSE 0
            END
          ), 0)::numeric AS scheduled_hours
        FROM filtered_staff fs
        CROSS JOIN date_span ds
        LEFT JOIN LATERAL (
          SELECT ss.is_available, ss.start_time, ss.end_time
          FROM staff_schedules ss
          WHERE ss.staff_id = fs.employee_id
            AND (
              ss.date = ds.work_date
              OR (
                ss.date IS NULL
                AND ss.day_of_week = EXTRACT(DOW FROM ds.work_date)::int
              )
            )
          ORDER BY CASE WHEN ss.date = ds.work_date THEN 0 ELSE 1 END
          LIMIT 1
        ) sch ON true
        GROUP BY fs.employee_id
      )`
      : `,
      schedule_hours AS (
        SELECT
          fs.employee_id,
          0::numeric AS scheduled_hours
        FROM filtered_staff fs
      )`;

    const metricsCte = `
      WITH filtered_staff AS (
        SELECT
          s.id AS employee_id,
          TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS employee_name,
          COALESCE(NULLIF(s.designation, ''), 'Staff') AS role,
          ${departmentExpr} AS department
        FROM staff s
        WHERE ${staffFilters.join(" AND ")}
      ),
      date_span AS (
        SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS work_date
      ),
      appointment_metrics AS (
        SELECT
          fs.employee_id,
          COUNT(a.id)::int AS total_bookings,
          COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed_appointments,
          COALESCE(SUM(
            CASE
              WHEN a.status = 'completed' THEN COALESCE(a.duration_minutes, 0)
              ELSE 0
            END
          ), 0)::numeric / 60.0 AS appointment_hours
        FROM filtered_staff fs
        LEFT JOIN appointments a
          ON a.staff_id = fs.employee_id
         AND a.salon_id = $1
         AND a.scheduled_at >= $2::date
         AND a.scheduled_at < ($3::date + INTERVAL '1 day')
        GROUP BY fs.employee_id
      ),
      attendance_hours AS (
        SELECT
          fs.employee_id,
          COALESCE(SUM(COALESCE(a.hours_worked, 0)), 0)::numeric AS attendance_hours
        FROM filtered_staff fs
        LEFT JOIN attendance a
          ON a.staff_id = fs.employee_id
         AND a.salon_id = $1
         AND a.date >= $2::date
         AND a.date <= $3::date
        GROUP BY fs.employee_id
      )
      ${workingHoursCte},
      direct_sales AS (
        SELECT
          fs.employee_id,
          COALESCE(SUM(sl.total_amount), 0)::numeric AS sales_revenue
        FROM filtered_staff fs
        LEFT JOIN sales sl
          ON sl.salon_id = $1
         AND sl.status = 'completed'
         AND sl.created_at >= $2::date
         AND sl.created_at < ($3::date + INTERVAL '1 day')
         AND (
           sl.staff_id = fs.employee_id
           OR sl.appointment_id IN (
             SELECT a.id
             FROM appointments a
             WHERE a.staff_id = fs.employee_id
               AND a.salon_id = $1
           )
         )
        GROUP BY fs.employee_id
      ),
      fallback_completed_appointment_revenue AS (
        SELECT
          fs.employee_id,
          COALESCE(SUM(
            COALESCE((
              SELECT SUM(COALESCE((item->>'price')::numeric, 0) * COALESCE((item->>'quantity')::numeric, 1))
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
              ) AS item
            ), 0)
          ), 0)::numeric AS appointment_revenue
        FROM filtered_staff fs
        LEFT JOIN appointments a
          ON a.staff_id = fs.employee_id
         AND a.salon_id = $1
         AND a.status = 'completed'
         AND a.scheduled_at >= $2::date
         AND a.scheduled_at < ($3::date + INTERVAL '1 day')
        WHERE a.id IS NULL
           OR NOT EXISTS (
             SELECT 1
             FROM sales sl
             WHERE sl.appointment_id = a.id
               AND sl.status = 'completed'
           )
        GROUP BY fs.employee_id
      ),
      employee_metrics AS (
        SELECT
          fs.employee_id,
          fs.employee_name,
          fs.role,
          fs.department,
          COALESCE(am.total_bookings, 0)::int AS total_bookings,
          COALESCE(am.completed_appointments, 0)::int AS completed_appointments,
          ROUND(COALESCE(NULLIF(sh.scheduled_hours, 0), ah.attendance_hours, 0)::numeric, 2) AS working_hours,
          ROUND(COALESCE(am.appointment_hours, 0)::numeric, 2) AS appointment_hours,
          ROUND(
            CASE
              WHEN COALESCE(NULLIF(sh.scheduled_hours, 0), ah.attendance_hours, 0) > 0
              THEN (
                COALESCE(am.appointment_hours, 0)
                / COALESCE(NULLIF(sh.scheduled_hours, 0), ah.attendance_hours)
              ) * 100
              ELSE 0
            END,
            2
          ) AS utilization_percentage,
          ROUND(COALESCE(ds.sales_revenue, 0) + COALESCE(fr.appointment_revenue, 0), 2) AS total_revenue_generated
        FROM filtered_staff fs
        LEFT JOIN appointment_metrics am ON am.employee_id = fs.employee_id
        LEFT JOIN attendance_hours ah ON ah.employee_id = fs.employee_id
        LEFT JOIN schedule_hours sh ON sh.employee_id = fs.employee_id
        LEFT JOIN direct_sales ds ON ds.employee_id = fs.employee_id
        LEFT JOIN fallback_completed_appointment_revenue fr ON fr.employee_id = fs.employee_id
      )`;

    const sortColumn = getEmployeePerformanceSortColumn(sortBy);
    const safeSortOrder = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const offset = (page - 1) * pageSize;

    const [rowsResult, summaryResult] = await Promise.all([
      pool.query<{
        employee_id: string;
        employee_name: string;
        role: string;
        department: string;
        total_bookings: string;
        completed_appointments: string;
        working_hours: string;
        appointment_hours: string;
        utilization_percentage: string;
        total_revenue_generated: string;
      }>(
        `${metricsCte}
         SELECT
           employee_id,
           employee_name,
           role,
           department,
           total_bookings,
           completed_appointments,
           working_hours,
           appointment_hours,
           utilization_percentage,
           total_revenue_generated
         FROM employee_metrics
         ORDER BY ${sortColumn} ${safeSortOrder}, employee_name ASC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset],
      ),
      pool.query<{
        total_employees: string;
        total_revenue: string;
        total_bookings: string;
        average_utilization_percentage: string;
        top_employee_id: string | null;
        top_employee_name: string | null;
        top_employee_revenue: string | null;
      }>(
        `${metricsCte}
         SELECT
           COUNT(*)::int AS total_employees,
           COALESCE(SUM(total_revenue_generated), 0)::numeric AS total_revenue,
           COALESCE(SUM(total_bookings), 0)::int AS total_bookings,
           COALESCE(AVG(utilization_percentage), 0)::numeric AS average_utilization_percentage,
           (ARRAY_AGG(employee_id ORDER BY total_revenue_generated DESC, employee_name ASC))[1] AS top_employee_id,
           (ARRAY_AGG(employee_name ORDER BY total_revenue_generated DESC, employee_name ASC))[1] AS top_employee_name,
           (ARRAY_AGG(total_revenue_generated ORDER BY total_revenue_generated DESC, employee_name ASC))[1]::numeric AS top_employee_revenue
         FROM employee_metrics`,
        params,
      ),
    ]);

    const rows: EmployeePerformanceRow[] = rowsResult.rows.map((row) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      role: row.role ?? "Staff",
      department: row.department ?? "General",
      totalBookings: parseInt(row.total_bookings ?? "0", 10) || 0,
      completedAppointments: parseInt(row.completed_appointments ?? "0", 10) || 0,
      workingHours: parseFloat(row.working_hours ?? "0") || 0,
      appointmentHours: parseFloat(row.appointment_hours ?? "0") || 0,
      utilizationPercentage: parseFloat(row.utilization_percentage ?? "0") || 0,
      totalRevenueGenerated: parseFloat(row.total_revenue_generated ?? "0") || 0,
    }));

    const summaryRow = summaryResult.rows[0];
    const total = parseInt(summaryRow?.total_employees ?? "0", 10) || 0;

    return {
      summary: {
        totalEmployees: total,
        totalRevenue: parseFloat(summaryRow?.total_revenue ?? "0") || 0,
        totalBookings: parseInt(summaryRow?.total_bookings ?? "0", 10) || 0,
        averageUtilizationPercentage: parseFloat(summaryRow?.average_utilization_percentage ?? "0") || 0,
        topPerformingEmployee: summaryRow?.top_employee_id
          ? {
              employeeId: summaryRow.top_employee_id,
              employeeName: summaryRow.top_employee_name ?? "",
              revenue: parseFloat(summaryRow.top_employee_revenue ?? "0") || 0,
            }
          : null,
      },
      rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
      },
    };
  },

  // ── Detail: Appointments ──────────────────────────────────────────────────────
  async getStaffRevenueAnalytics(
    salonId: string,
    query: NormalizedStaffRevenueAnalyticsQuery,
  ): Promise<StaffRevenueAnalyticsReport> {
    const { from, to, staffId, role } = query;
    const startDate = new Date(`${from}T00:00:00.000Z`);
    const endDate = new Date(`${to}T00:00:00.000Z`);
    const rangeDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
    const previousEndDate = new Date(startDate);
    const previousStartDate = new Date(startDate);

    previousEndDate.setUTCDate(previousEndDate.getUTCDate() - 1);
    previousStartDate.setUTCDate(previousStartDate.getUTCDate() - rangeDays);

    const params: Array<string> = [
      salonId,
      from,
      to,
      previousStartDate.toISOString().slice(0, 10),
      previousEndDate.toISOString().slice(0, 10),
    ];
    let paramIndex = params.length + 1;
    const staffFilters: string[] = ["s.salon_id = $1", "s.is_active = true"];

    if (staffId) {
      staffFilters.push(`s.id = $${paramIndex}`);
      params.push(staffId);
      paramIndex += 1;
    }

    if (role && role !== "All") {
      staffFilters.push(`COALESCE(s.designation, '') ILIKE $${paramIndex}`);
      params.push(`%${role}%`);
      paramIndex += 1;
    }

    const analyticsCte = `
      WITH filtered_staff AS (
        SELECT
          s.id AS staff_id,
          TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
          COALESCE(NULLIF(s.designation, ''), 'Staff') AS role
        FROM staff s
        WHERE ${staffFilters.join(" AND ")}
      ),
      current_sales AS (
        SELECT
          COALESCE(si.staff_id, sl.staff_id) AS staff_id,
          COALESCE(SUM(CASE WHEN si.item_type = 'service' THEN COALESCE(si.total_price, 0) ELSE 0 END), 0)::numeric AS service_revenue,
          COALESCE(SUM(CASE WHEN si.item_type = 'product' THEN COALESCE(si.total_price, 0) ELSE 0 END), 0)::numeric AS product_revenue
        FROM sales sl
        JOIN sale_items si ON si.sale_id = sl.id
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
          AND sl.created_at >= $2::date
          AND sl.created_at < ($3::date + INTERVAL '1 day')
          AND COALESCE(si.staff_id, sl.staff_id) IS NOT NULL
          AND si.item_type IN ('service', 'product')
        GROUP BY COALESCE(si.staff_id, sl.staff_id)
      ),
      previous_sales AS (
        SELECT
          COALESCE(si.staff_id, sl.staff_id) AS staff_id,
          COALESCE(SUM(COALESCE(si.total_price, 0)), 0)::numeric AS total_revenue
        FROM sales sl
        JOIN sale_items si ON si.sale_id = sl.id
        WHERE sl.salon_id = $1
          AND sl.status = 'completed'
          AND sl.created_at >= $4::date
          AND sl.created_at < ($5::date + INTERVAL '1 day')
          AND COALESCE(si.staff_id, sl.staff_id) IS NOT NULL
          AND si.item_type IN ('service', 'product')
        GROUP BY COALESCE(si.staff_id, sl.staff_id)
      ),
      staff_revenue AS (
        SELECT
          fs.staff_id,
          fs.staff_name,
          fs.role,
          ROUND(COALESCE(cs.service_revenue, 0), 2) AS service_revenue,
          ROUND(COALESCE(cs.product_revenue, 0), 2) AS product_revenue,
          ROUND(COALESCE(cs.service_revenue, 0) + COALESCE(cs.product_revenue, 0), 2) AS total_revenue,
          ROUND((COALESCE(cs.service_revenue, 0) + COALESCE(cs.product_revenue, 0)) / ${rangeDays}::numeric, 2) AS avg_daily_revenue,
          ROUND(COALESCE(ps.total_revenue, 0), 2) AS previous_total_revenue
        FROM filtered_staff fs
        LEFT JOIN current_sales cs ON cs.staff_id = fs.staff_id
        LEFT JOIN previous_sales ps ON ps.staff_id = fs.staff_id
      )
      SELECT
        staff_id,
        staff_name,
        role,
        service_revenue,
        product_revenue,
        total_revenue,
        avg_daily_revenue,
        previous_total_revenue
      FROM staff_revenue
      ORDER BY total_revenue DESC, staff_name ASC`;

    const { rows } = await pool.query<{
      staff_id: string;
      staff_name: string;
      role: string;
      service_revenue: string;
      product_revenue: string;
      total_revenue: string;
      avg_daily_revenue: string;
      previous_total_revenue: string;
    }>(analyticsCte, params);

    const normalizedRows: StaffRevenueAnalyticsRow[] = rows.map((row) => {
      const serviceRevenue = parseFloat(row.service_revenue ?? "0") || 0;
      const productRevenue = parseFloat(row.product_revenue ?? "0") || 0;
      const totalRevenue = parseFloat(row.total_revenue ?? "0") || 0;
      const avgDailyRevenue = parseFloat(row.avg_daily_revenue ?? "0") || 0;
      const previousTotalRevenue = parseFloat(row.previous_total_revenue ?? "0") || 0;

      return {
        staffId: row.staff_id,
        staffName: row.staff_name,
        role: row.role ?? "Staff",
        serviceRevenue,
        productRevenue,
        totalRevenue,
        avgDailyRevenue,
        growthPercentage: percentChange(totalRevenue, previousTotalRevenue),
      };
    });

    const totalStaffRevenue = normalizedRows.reduce((sum, row) => sum + row.totalRevenue, 0);
    const totalServiceRevenue = normalizedRows.reduce((sum, row) => sum + row.serviceRevenue, 0);
    const totalProductRevenue = normalizedRows.reduce((sum, row) => sum + row.productRevenue, 0);
    const topRow = normalizedRows[0] ?? null;

    return {
      summary: {
        totalStaffRevenue: Math.round(totalStaffRevenue * 100) / 100,
        totalServiceRevenue: Math.round(totalServiceRevenue * 100) / 100,
        totalProductRevenue: Math.round(totalProductRevenue * 100) / 100,
        topPerformingStaff: topRow
          ? {
              staffId: topRow.staffId,
              staffName: topRow.staffName,
              totalRevenue: topRow.totalRevenue,
            }
          : null,
      },
      rows: normalizedRows,
    };
  },

  async getStaffProductSales(
    salonId: string,
    query: NormalizedStaffProductSalesQuery,
  ): Promise<StaffProductSalesReport> {
    const {
      from,
      to,
      staffId,
      role,
      productCategory,
      productName,
      search,
      sortBy,
    } = query;

    const params: Array<string> = [salonId, from, to];
    let paramIndex = params.length + 1;
    const filters: string[] = [
      "sl.salon_id = $1",
      "sl.status = 'completed'",
      "sl.created_at >= $2::date",
      "sl.created_at < ($3::date + INTERVAL '1 day')",
      "si.item_type = 'product'",
      "COALESCE(si.staff_id, sl.staff_id) IS NOT NULL",
    ];

    if (staffId) {
      filters.push(`COALESCE(si.staff_id, sl.staff_id) = $${paramIndex}`);
      params.push(staffId);
      paramIndex += 1;
    }

    if (role && role !== "All") {
      filters.push(`COALESCE(st.designation, '') ILIKE $${paramIndex}`);
      params.push(`%${role}%`);
      paramIndex += 1;
    }

    if (productCategory) {
      filters.push(`p.category_id::text = $${paramIndex}`);
      params.push(productCategory);
      paramIndex += 1;
    }

    if (productName) {
      filters.push(`COALESCE(si.name, p.name, '') ILIKE $${paramIndex}`);
      params.push(`%${productName}%`);
      paramIndex += 1;
    }

    if (search) {
      filters.push(`(
        TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')) ILIKE $${paramIndex}
        OR COALESCE(si.name, p.name, '') ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    const sortClauseMap: Record<NormalizedStaffProductSalesQuery["sortBy"], string> = {
      highest_revenue: "product_revenue DESC, staff_name ASC",
      lowest_revenue: "product_revenue ASC, staff_name ASC",
      highest_quantity_sold: "products_sold_qty DESC, staff_name ASC",
      lowest_quantity_sold: "products_sold_qty ASC, staff_name ASC",
      highest_avg_product_value: "avg_product_value DESC, staff_name ASC",
    };

    const reportQuery = `
      WITH product_sales AS (
        SELECT
          COALESCE(si.staff_id, sl.staff_id) AS staff_id,
          TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')) AS staff_name,
          COALESCE(NULLIF(st.designation, ''), 'Staff') AS role,
          COALESCE(si.name, p.name, 'Product') AS product_name,
          COALESCE(si.quantity, 0)::numeric AS quantity,
          COALESCE(si.total_price, 0)::numeric AS revenue
        FROM sales sl
        JOIN sale_items si ON si.sale_id = sl.id
        LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, sl.staff_id)
        LEFT JOIN products p ON p.id::text = si.item_id::text
        WHERE ${filters.join(" AND ")}
      ),
      product_ranked AS (
        SELECT
          staff_id,
          staff_name,
          role,
          product_name,
          SUM(quantity)::numeric AS quantity_sold,
          ROW_NUMBER() OVER (
            PARTITION BY staff_id
            ORDER BY SUM(quantity) DESC, product_name ASC
          ) AS product_rank
        FROM product_sales
        GROUP BY staff_id, staff_name, role, product_name
      ),
      aggregated AS (
        SELECT
          ps.staff_id,
          ps.staff_name,
          ps.role,
          COALESCE(SUM(ps.quantity), 0)::numeric AS products_sold_qty,
          COALESCE(SUM(ps.revenue), 0)::numeric AS product_revenue,
          COALESCE(MAX(CASE WHEN pr.product_rank = 1 THEN pr.product_name END), '') AS top_selling_product
        FROM product_sales ps
        LEFT JOIN product_ranked pr
          ON pr.staff_id = ps.staff_id
         AND pr.product_rank = 1
        GROUP BY ps.staff_id, ps.staff_name, ps.role
      ),
      top_product_overall AS (
        SELECT
          product_name,
          SUM(quantity)::numeric AS total_qty,
          ROW_NUMBER() OVER (ORDER BY SUM(quantity) DESC, product_name ASC) AS overall_rank
        FROM product_sales
        GROUP BY product_name
      )
      SELECT
        a.staff_id,
        a.staff_name,
        a.role,
        ROUND(a.products_sold_qty, 2) AS products_sold_qty,
        ROUND(a.product_revenue, 2) AS product_revenue,
        ROUND(
          CASE
            WHEN a.products_sold_qty > 0 THEN a.product_revenue / a.products_sold_qty
            ELSE 0
          END,
          2
        ) AS avg_product_value,
        a.top_selling_product,
        (SELECT product_name FROM top_product_overall WHERE overall_rank = 1) AS top_selling_product_overall
      FROM aggregated a
      ORDER BY ${sortClauseMap[sortBy]}`;

    const { rows } = await pool.query<{
      staff_id: string;
      staff_name: string;
      role: string;
      products_sold_qty: string;
      product_revenue: string;
      avg_product_value: string;
      top_selling_product: string;
      top_selling_product_overall: string | null;
    }>(reportQuery, params);

    const tableData: StaffProductSalesRow[] = rows.map((row) => ({
      staffId: row.staff_id,
      staffName: row.staff_name,
      role: row.role ?? "Staff",
      productsSoldQty: parseFloat(row.products_sold_qty ?? "0") || 0,
      productRevenue: parseFloat(row.product_revenue ?? "0") || 0,
      avgProductValue: parseFloat(row.avg_product_value ?? "0") || 0,
      topSellingProduct: row.top_selling_product ?? "",
    }));

    const totalProductRevenue = tableData.reduce((sum, row) => sum + row.productRevenue, 0);
    const totalProductsSold = tableData.reduce((sum, row) => sum + row.productsSoldQty, 0);
    const topProductSellerRow = tableData.reduce<StaffProductSalesRow | null>((topRow, row) => {
      if (!topRow) return row;
      if (row.productsSoldQty > topRow.productsSoldQty) return row;
      if (row.productsSoldQty === topRow.productsSoldQty && row.staffName < topRow.staffName) return row;
      return topRow;
    }, null);
    const topProductSeller = topProductSellerRow?.staffName ?? "";
    const topSellingProduct = rows[0]?.top_selling_product_overall ?? "";

    return {
      summary: {
        totalProductRevenue: Math.round(totalProductRevenue * 100) / 100,
        totalProductsSold: Math.round(totalProductsSold * 100) / 100,
        topProductSeller,
        topSellingProduct,
      },
      tableData,
    };
  },

  async getStaffServiceSales(
    salonId: string,
    query: NormalizedStaffServiceSalesQuery,
  ): Promise<StaffServiceSalesReport> {
    const {
      from,
      to,
      staffId,
      role,
      serviceCategory,
      serviceName,
      sortBy,
    } = query;

    const params: Array<string> = [salonId, from, to];
    let paramIndex = params.length + 1;
    const filters: string[] = [
      "sl.salon_id = $1",
      "sl.status = 'completed'",
      "sl.created_at >= $2::date",
      "sl.created_at < ($3::date + INTERVAL '1 day')",
      "si.item_type = 'service'",
      "COALESCE(si.staff_id, sl.staff_id) IS NOT NULL",
    ];

    if (staffId) {
      filters.push(`COALESCE(si.staff_id, sl.staff_id) = $${paramIndex}`);
      params.push(staffId);
      paramIndex += 1;
    }

    if (role && role !== "All") {
      filters.push(`COALESCE(st.designation, '') ILIKE $${paramIndex}`);
      params.push(`%${role}%`);
      paramIndex += 1;
    }

    if (serviceCategory) {
      filters.push(`srv.category_id::text = $${paramIndex}`);
      params.push(serviceCategory);
      paramIndex += 1;
    }

    if (serviceName) {
      filters.push(`COALESCE(si.name, srv.name, '') ILIKE $${paramIndex}`);
      params.push(`%${serviceName}%`);
      paramIndex += 1;
    }

    const sortClauseMap: Record<NormalizedStaffServiceSalesQuery["sortBy"], string> = {
      highest_revenue: "service_revenue DESC, staff_name ASC",
      lowest_revenue: "service_revenue ASC, staff_name ASC",
      most_services_completed: "services_completed DESC, staff_name ASC",
      least_services_completed: "services_completed ASC, staff_name ASC",
      most_customers_served: "customers_served DESC, staff_name ASC",
    };

    const reportQuery = `
      WITH service_sales AS (
        SELECT
          COALESCE(si.staff_id, sl.staff_id) AS staff_id,
          TRIM(COALESCE(st.first_name, '') || ' ' || COALESCE(st.last_name, '')) AS staff_name,
          COALESCE(NULLIF(st.designation, ''), 'Staff') AS role,
          COALESCE(sl.client_id::text, '') AS client_id,
          COALESCE(si.name, srv.name, 'Service') AS service_name,
          COALESCE(si.quantity, 0)::numeric AS quantity,
          COALESCE(si.total_price, 0)::numeric AS revenue
        FROM sales sl
        JOIN sale_items si ON si.sale_id = sl.id
        LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, sl.staff_id)
        LEFT JOIN services srv ON (
          srv.id::text = si.item_id::text
          OR (si.item_id IS NULL AND lower(srv.name) = lower(COALESCE(si.name, '')))
        )
        WHERE ${filters.join(" AND ")}
      ),
      service_ranked AS (
        SELECT
          staff_id,
          staff_name,
          role,
          service_name,
          SUM(quantity)::numeric AS service_count,
          ROW_NUMBER() OVER (
            PARTITION BY staff_id
            ORDER BY SUM(quantity) DESC, service_name ASC
          ) AS service_rank
        FROM service_sales
        GROUP BY staff_id, staff_name, role, service_name
      ),
      aggregated AS (
        SELECT
          ss.staff_id,
          ss.staff_name,
          ss.role,
          COALESCE(SUM(ss.quantity), 0)::numeric AS services_completed,
          COALESCE(SUM(ss.revenue), 0)::numeric AS service_revenue,
          COUNT(DISTINCT NULLIF(ss.client_id, ''))::int AS customers_served,
          COALESCE(MAX(CASE WHEN sr.service_rank = 1 THEN sr.service_name END), '') AS top_service
        FROM service_sales ss
        LEFT JOIN service_ranked sr
          ON sr.staff_id = ss.staff_id
         AND sr.service_rank = 1
        GROUP BY ss.staff_id, ss.staff_name, ss.role
      )
      SELECT
        a.staff_id,
        a.staff_name,
        a.role,
        ROUND(a.services_completed, 2) AS services_completed,
        ROUND(a.service_revenue, 2) AS service_revenue,
        a.customers_served,
        ROUND(
          CASE
            WHEN a.services_completed > 0 THEN a.service_revenue / a.services_completed
            ELSE 0
          END,
          2
        ) AS avg_service_value,
        a.top_service
      FROM aggregated a
      ORDER BY ${sortClauseMap[sortBy]}`;

    const { rows } = await pool.query<{
      staff_id: string;
      staff_name: string;
      role: string;
      services_completed: string;
      service_revenue: string;
      customers_served: string;
      avg_service_value: string;
      top_service: string;
    }>(reportQuery, params);

    const tableData: StaffServiceSalesRow[] = rows.map((row) => ({
      staffId: row.staff_id,
      staffName: row.staff_name,
      role: row.role ?? "Staff",
      servicesCompleted: parseFloat(row.services_completed ?? "0") || 0,
      serviceRevenue: parseFloat(row.service_revenue ?? "0") || 0,
      customersServed: parseInt(row.customers_served ?? "0", 10) || 0,
      avgServiceValue: parseFloat(row.avg_service_value ?? "0") || 0,
      topService: row.top_service ?? "",
    }));

    const totalServiceRevenue = tableData.reduce((sum, row) => sum + row.serviceRevenue, 0);
    const totalServicesCompleted = tableData.reduce((sum, row) => sum + row.servicesCompleted, 0);
    const averageServiceValue = totalServicesCompleted > 0
      ? Math.round((totalServiceRevenue / totalServicesCompleted) * 100) / 100
      : 0;
    const topPerformer = tableData.reduce<StaffServiceSalesRow | null>((topRow, row) => {
      if (!topRow) return row;
      if (row.serviceRevenue > topRow.serviceRevenue) return row;
      if (row.serviceRevenue === topRow.serviceRevenue && row.staffName < topRow.staffName) return row;
      return topRow;
    }, null);

    return {
      summary: {
        totalServiceRevenue: Math.round(totalServiceRevenue * 100) / 100,
        totalServicesCompleted: Math.round(totalServicesCompleted * 100) / 100,
        topPerformer: topPerformer?.staffName ?? "",
        averageServiceValue,
      },
      tableData,
    };
  },

  async getSalesDashboard(
    salonId: string,
    query: NormalizedSalesDashboardQuery,
  ): Promise<SalesDashboardResponse> {
    const { cte, params } = buildSalesDashboardBaseQuery(salonId, query);
    const requestedSections = new Set(query.sections);
    const needsSummary = requestedSections.has("kpiCards") || requestedSections.has("revenueSources");
    const needsPaymentCollection = requestedSections.has("paymentCollection");
    const needsCharts = requestedSections.has("charts");
    const needsEmployeeTable = requestedSections.has("employeeSalesTable");
    const needsEmployeeDrillDowns = requestedSections.has("employeeDrillDowns");
    const trendExprMap: Record<SalesDashboardTrendGroup, string> = {
      daily: "DATE_TRUNC('day', sale_date)",
      weekly: "DATE_TRUNC('week', sale_date)",
      monthly: "DATE_TRUNC('month', sale_date)",
      yearly: "DATE_TRUNC('year', sale_date)",
    };
    const trendLabelMap: Record<SalesDashboardTrendGroup, string> = {
      daily: "YYYY-MM-DD",
      weekly: "YYYY-MM-DD",
      monthly: "YYYY-MM",
      yearly: "YYYY",
    };
    const employeeSortMap: Record<NormalizedSalesDashboardQuery["sortBy"], string> = {
      revenue: "total_revenue",
      servicesSold: "services_sold",
      productRevenue: "product_revenue",
      averageTicket: "average_ticket",
    };

    const offset = (query.page - 1) * query.pageSize;
    const employeeSearchClause = query.search ? `WHERE employee_name ILIKE $${params.length + 1}` : "";
    const employeeTableParams = query.search ? [...params, `%${query.search}%`] : [...params];
    const employeePagingParams = [...employeeTableParams, query.pageSize, offset];

    const summarySql = `${cte}
      SELECT
        COALESCE((SELECT SUM(subtotal) FROM filtered_sales), 0)::numeric AS gross_sales,
        COALESCE(SUM(line_revenue) FILTER (WHERE sale_type = 'service'), 0)::numeric AS service_revenue,
        COALESCE(SUM(line_revenue) FILTER (WHERE sale_type = 'product'), 0)::numeric AS product_revenue,
        COALESCE(SUM(line_revenue) FILTER (WHERE sale_type = 'package'), 0)::numeric AS package_revenue,
        COALESCE(SUM(line_revenue) FILTER (WHERE sale_type = 'membership'), 0)::numeric AS membership_revenue,
        COALESCE(SUM(line_revenue) FILTER (WHERE sale_type = 'gift_card'), 0)::numeric AS gift_card_revenue,
        (SELECT COUNT(*)::int FROM filtered_sales) AS total_transactions,
        COALESCE((SELECT SUM(total_amount) FROM filtered_sales), 0)::numeric AS total_revenue,
        COALESCE((SELECT SUM(tax_amount) FROM filtered_sales), 0)::numeric AS taxes,
        COALESCE((SELECT SUM(advance_added) FROM filtered_sales), 0)::numeric AS advance_added
      FROM filtered_line_items`;

    const paymentSql = `${cte}
      SELECT
        payment_method,
        COUNT(*)::int AS transactions,
        COALESCE(SUM(total_amount), 0)::numeric AS total_amount
      FROM filtered_sales
      GROUP BY payment_method
      ORDER BY total_amount DESC, payment_method ASC`;

    const saleTypeSql = `${cte}
      SELECT
        sale_type,
        COALESCE(SUM(line_revenue), 0)::numeric AS revenue
      FROM filtered_line_items
      GROUP BY sale_type
      ORDER BY revenue DESC, sale_type ASC`;

    const staffRevenueSql = `${cte}
      SELECT
        employee_id,
        employee_name,
        COALESCE(SUM(line_revenue), 0)::numeric AS total_revenue
      FROM filtered_line_items
      GROUP BY employee_id, employee_name
      ORDER BY total_revenue DESC, employee_name ASC
      LIMIT 10`;

    const topServicesSql = `${cte}
      SELECT
        item_name AS service_name,
        COALESCE(SUM(quantity), 0)::numeric AS quantity_sold,
        COALESCE(SUM(line_revenue), 0)::numeric AS revenue
      FROM filtered_line_items
      WHERE sale_type = 'service'
      GROUP BY item_name
      ORDER BY revenue DESC, quantity_sold DESC, item_name ASC
      LIMIT 10`;

    const topProductsSql = `${cte}
      SELECT
        item_name AS product_name,
        COALESCE(SUM(quantity), 0)::numeric AS quantity_sold,
        COALESCE(SUM(line_revenue), 0)::numeric AS revenue
      FROM filtered_line_items
      WHERE sale_type = 'product'
      GROUP BY item_name
      ORDER BY revenue DESC, quantity_sold DESC, item_name ASC
      LIMIT 10`;

    const trendSql = `${cte}
      SELECT
        TO_CHAR(${trendExprMap[query.groupBy]}, '${trendLabelMap[query.groupBy]}') AS period,
        COALESCE(SUM(total_amount), 0)::numeric AS revenue
      FROM filtered_sales
      GROUP BY ${trendExprMap[query.groupBy]}
      ORDER BY ${trendExprMap[query.groupBy]} ASC`;

    const employeeTableSql = `${cte}
      , employee_aggregates AS (
        SELECT
          employee_id,
          employee_name,
          MAX(role) AS role,
          COUNT(DISTINCT COALESCE(NULLIF(appointment_id, ''), sale_id))::int AS bookings,
          COALESCE(SUM(CASE WHEN sale_type = 'service' THEN quantity ELSE 0 END), 0)::numeric AS services_sold,
          COALESCE(SUM(CASE WHEN sale_type = 'product' THEN quantity ELSE 0 END), 0)::numeric AS products_sold,
          COALESCE(SUM(CASE WHEN sale_type = 'service' THEN line_revenue ELSE 0 END), 0)::numeric AS service_revenue,
          COALESCE(SUM(CASE WHEN sale_type = 'product' THEN line_revenue ELSE 0 END), 0)::numeric AS product_revenue,
          COALESCE(SUM(line_revenue), 0)::numeric AS total_revenue,
          COUNT(DISTINCT NULLIF(client_id, ''))::int AS customers_served,
          CASE
            WHEN COUNT(DISTINCT sale_id) > 0 THEN COALESCE(SUM(line_revenue), 0) / COUNT(DISTINCT sale_id)
            ELSE 0
          END::numeric AS average_ticket
        FROM filtered_line_items
        GROUP BY employee_id, employee_name
      )
      SELECT
        employee_id,
        employee_name,
        role,
        bookings,
        ROUND(services_sold, 2) AS services_sold,
        ROUND(products_sold, 2) AS products_sold,
        ROUND(service_revenue, 2) AS service_revenue,
        ROUND(product_revenue, 2) AS product_revenue,
        ROUND(total_revenue, 2) AS total_revenue,
        ROUND(average_ticket, 2) AS average_ticket,
        customers_served,
        COUNT(*) OVER()::int AS total_count
      FROM employee_aggregates
      ${employeeSearchClause}
      ORDER BY ${employeeSortMap[query.sortBy]} ${query.sortOrder.toUpperCase()}, employee_name ASC
      LIMIT $${employeePagingParams.length - 1} OFFSET $${employeePagingParams.length}`;

    const [
      summaryRows,
      paymentRows,
      saleTypeRows,
      staffRevenueRows,
      topServiceRows,
      topProductRows,
      trendRows,
      employeeTableRows,
    ] = await Promise.all([
      needsSummary || needsCharts ? pool.query(summarySql, params) : Promise.resolve({ rows: [] }),
      needsPaymentCollection ? pool.query(paymentSql, params) : Promise.resolve({ rows: [] }),
      needsCharts ? pool.query(saleTypeSql, params) : Promise.resolve({ rows: [] }),
      needsCharts ? pool.query(staffRevenueSql, params) : Promise.resolve({ rows: [] }),
      needsCharts ? pool.query(topServicesSql, params) : Promise.resolve({ rows: [] }),
      needsCharts ? pool.query(topProductsSql, params) : Promise.resolve({ rows: [] }),
      needsCharts ? pool.query(trendSql, params) : Promise.resolve({ rows: [] }),
      needsEmployeeTable ? pool.query(employeeTableSql, employeePagingParams) : Promise.resolve({ rows: [] }),
    ]);

    const summary = summaryRows.rows[0] as {
      gross_sales?: string;
      service_revenue?: string;
      product_revenue?: string;
      package_revenue?: string;
      membership_revenue?: string;
      gift_card_revenue?: string;
      total_transactions?: string;
      total_revenue?: string;
      taxes?: string;
      advance_added?: string;
    } | undefined;

    const totalRevenue = parseFloat(summary?.total_revenue ?? "0");
    const totalTransactions = parseInt(summary?.total_transactions ?? "0", 10) || 0;
    const serviceRevenue = parseFloat(summary?.service_revenue ?? "0");
    const productRevenue = parseFloat(summary?.product_revenue ?? "0");
    const packageRevenue = parseFloat(summary?.package_revenue ?? "0");
    const membershipRevenue = parseFloat(summary?.membership_revenue ?? "0");
    const giftCardRevenue = parseFloat(summary?.gift_card_revenue ?? "0");

    const employeeRows: SalesDashboardEmployeeRow[] = employeeTableRows.rows.map((row: any) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      role: row.role ?? "Staff",
      bookings: parseInt(row.bookings ?? "0", 10) || 0,
      servicesSold: parseFloat(row.services_sold ?? "0") || 0,
      productsSold: parseFloat(row.products_sold ?? "0") || 0,
      serviceRevenue: parseFloat(row.service_revenue ?? "0") || 0,
      productRevenue: parseFloat(row.product_revenue ?? "0") || 0,
      totalRevenue: parseFloat(row.total_revenue ?? "0") || 0,
      averageTicket: parseFloat(row.average_ticket ?? "0") || 0,
      customersServed: parseInt(row.customers_served ?? "0", 10) || 0,
    }));

    const employeeIds = query.employeeId
      ? [query.employeeId]
      : Array.from(new Set(employeeRows.map((row) => row.employeeId))).filter(Boolean);
    let employeeDrillDowns: Record<string, SalesDashboardEmployeeDrillDown> = {};

    if (needsEmployeeDrillDowns && employeeIds.length > 0) {
      const drillParams = [...params, employeeIds];
      const employeeIdParam = drillParams.length;

      const drillSummarySql = `${cte}
        SELECT
          employee_id,
          employee_name,
          MAX(role) AS role,
          COUNT(DISTINCT sale_id)::int AS sales_count,
          COUNT(DISTINCT COALESCE(NULLIF(appointment_id, ''), sale_id))::int AS bookings,
          COUNT(DISTINCT NULLIF(client_id, ''))::int AS customers,
          COALESCE(SUM(CASE WHEN sale_type = 'service' THEN line_revenue ELSE 0 END), 0)::numeric AS service_revenue,
          COALESCE(SUM(CASE WHEN sale_type = 'product' THEN line_revenue ELSE 0 END), 0)::numeric AS product_revenue,
          COALESCE(SUM(line_revenue), 0)::numeric AS total_revenue
        FROM filtered_line_items
        WHERE employee_id = ANY($${employeeIdParam}::text[])
        GROUP BY employee_id, employee_name`;

      const drillAppointmentsSql = `${cte}
        SELECT
          employee_id,
          TO_CHAR(appointment_date, 'YYYY-MM-DD') AS appointment_date,
          client_name,
          COALESCE(
            STRING_AGG(DISTINCT item_name, ', ' ORDER BY item_name)
              FILTER (WHERE sale_type IN ('service', 'package', 'membership', 'gift_card')),
            'Sale'
          ) AS service_name,
          COALESCE(MAX(total_amount), 0)::numeric AS amount,
          COALESCE(MAX(payment_method), 'unknown') AS payment_method,
          'completed' AS status
        FROM filtered_line_items
        WHERE employee_id = ANY($${employeeIdParam}::text[])
        GROUP BY employee_id, sale_id, appointment_date, client_name
        ORDER BY MAX(appointment_date) DESC`;

      const drillServicesSql = `${cte}
        SELECT
          employee_id,
          item_name AS service_name,
          COALESCE(SUM(quantity), 0)::numeric AS quantity,
          COALESCE(SUM(line_revenue), 0)::numeric AS revenue
        FROM filtered_line_items
        WHERE employee_id = ANY($${employeeIdParam}::text[])
          AND sale_type IN ('service', 'package')
        GROUP BY employee_id, item_name
        ORDER BY revenue DESC, quantity DESC, item_name ASC`;

      const drillProductsSql = `${cte}
        SELECT
          employee_id,
          item_name AS product_name,
          COALESCE(SUM(quantity), 0)::numeric AS quantity,
          COALESCE(SUM(line_revenue), 0)::numeric AS revenue
        FROM filtered_line_items
        WHERE employee_id = ANY($${employeeIdParam}::text[])
          AND sale_type = 'product'
        GROUP BY employee_id, item_name
        ORDER BY revenue DESC, quantity DESC, item_name ASC`;

      const [
        drillSummaryRows,
        drillAppointmentRows,
        drillServiceRows,
        drillProductRows,
      ] = await Promise.all([
        pool.query(drillSummarySql, drillParams),
        pool.query(drillAppointmentsSql, drillParams),
        pool.query(drillServicesSql, drillParams),
        pool.query(drillProductsSql, drillParams),
      ]);

      employeeDrillDowns = Object.fromEntries(
        employeeIds.map((employeeId) => {
          const summaryRow = drillSummaryRows.rows.find((row: any) => row.employee_id === employeeId);
          const appointmentDetails: SalesDashboardEmployeeAppointmentDetail[] = drillAppointmentRows.rows
            .filter((row: any) => row.employee_id === employeeId)
            .map((row: any) => ({
              appointmentDate: row.appointment_date,
              clientName: row.client_name,
              serviceName: row.service_name,
              amount: parseFloat(row.amount ?? "0") || 0,
              paymentMethod: row.payment_method,
              status: row.status,
            }));
          const servicesPerformed: SalesDashboardEmployeeServiceDetail[] = drillServiceRows.rows
            .filter((row: any) => row.employee_id === employeeId)
            .map((row: any) => ({
              serviceName: row.service_name,
              quantity: parseFloat(row.quantity ?? "0") || 0,
              revenue: parseFloat(row.revenue ?? "0") || 0,
            }));
          const productsSold: SalesDashboardEmployeeProductDetail[] = drillProductRows.rows
            .filter((row: any) => row.employee_id === employeeId)
            .map((row: any) => ({
              productName: row.product_name,
              quantity: parseFloat(row.quantity ?? "0") || 0,
              revenue: parseFloat(row.revenue ?? "0") || 0,
            }));

          const totalRevenueForEmployee = parseFloat(summaryRow?.total_revenue ?? "0") || 0;
          const salesCount = parseInt(summaryRow?.sales_count ?? "0", 10) || 0;

          return [
            employeeId,
            {
              employeeSummary: {
                employeeId,
                employeeName: summaryRow?.employee_name ?? employeeRows.find((row) => row.employeeId === employeeId)?.employeeName ?? "Unassigned",
                role: summaryRow?.role ?? employeeRows.find((row) => row.employeeId === employeeId)?.role ?? "Staff",
                totalRevenue: totalRevenueForEmployee,
                serviceRevenue: parseFloat(summaryRow?.service_revenue ?? "0") || 0,
                productRevenue: parseFloat(summaryRow?.product_revenue ?? "0") || 0,
                bookings: parseInt(summaryRow?.bookings ?? "0", 10) || 0,
                customers: parseInt(summaryRow?.customers ?? "0", 10) || 0,
                averageTicket: salesCount > 0 ? formatMoney(totalRevenueForEmployee / salesCount) : 0,
              },
              appointmentDetails,
              servicesPerformed,
              productsSold,
            } satisfies SalesDashboardEmployeeDrillDown,
          ];
        }),
      );
    }

    const paymentMethods = paymentRows.rows.map((row: any) => ({
      paymentMethod: row.payment_method,
      totalAmount: parseFloat(row.total_amount ?? "0") || 0,
      transactions: parseInt(row.transactions ?? "0", 10) || 0,
    }));

    const revenueBySaleType = saleTypeRows.rows.map((row: any) => ({
      type: row.sale_type,
      revenue: parseFloat(row.revenue ?? "0") || 0,
    }));

    const staffRevenue = staffRevenueRows.rows.map((row: any) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      totalRevenue: parseFloat(row.total_revenue ?? "0") || 0,
    }));

    const revenueDistribution = revenueBySaleType.map((row) => ({
      type: row.type,
      revenue: row.revenue,
      percentage: totalRevenue > 0 ? formatMoney((row.revenue / totalRevenue) * 100) : 0,
    }));

    const totalEmployees = parseInt(employeeTableRows.rows[0]?.total_count ?? "0", 10) || 0;

    const response: SalesDashboardResponse = {
      filters: {
        from: query.from,
        to: query.to,
        employeeId: query.employeeId,
        employeeType: query.employeeType,
        activity: query.activity,
        branchId: query.branchId,
        groupBy: query.groupBy,
      },
      requestedSections: query.sections,
    };

    if (requestedSections.has("kpiCards")) {
      response.kpiCards = {
        grossSales: formatMoney(parseFloat(summary?.gross_sales ?? "0") || 0),
        serviceRevenue: formatMoney(serviceRevenue),
        productRevenue: formatMoney(productRevenue),
        packageRevenue: formatMoney(packageRevenue),
        membershipRevenue: formatMoney(membershipRevenue),
        giftCardRevenue: formatMoney(giftCardRevenue),
        totalTransactions,
        averageTicketValue: totalTransactions > 0 ? formatMoney(totalRevenue / totalTransactions) : 0,
      };
    }

    if (requestedSections.has("revenueSources")) {
      response.revenueSources = {
        serviceRevenue: formatMoney(serviceRevenue),
        productRevenue: formatMoney(productRevenue),
        packageRevenue: formatMoney(packageRevenue),
        membershipRevenue: formatMoney(membershipRevenue),
        giftCardRevenue: formatMoney(giftCardRevenue),
        taxes: formatMoney(parseFloat(summary?.taxes ?? "0") || 0),
        advanceAdded: formatMoney(parseFloat(summary?.advance_added ?? "0") || 0),
        totalRevenue: formatMoney(totalRevenue),
      };
    }

    if (requestedSections.has("paymentCollection")) {
      response.paymentCollection = {
        totalAmount: formatMoney(paymentMethods.reduce((sum, method) => sum + method.totalAmount, 0)),
        methods: paymentMethods,
      };
    }

    if (requestedSections.has("charts")) {
      response.charts = {
        revenueBySaleType,
        staffRevenue,
        revenueDistribution,
        topServices: topServiceRows.rows.map((row: any) => ({
          serviceName: row.service_name,
          revenue: parseFloat(row.revenue ?? "0") || 0,
          quantitySold: parseFloat(row.quantity_sold ?? "0") || 0,
        })),
        topProducts: topProductRows.rows.map((row: any) => ({
          productName: row.product_name,
          revenue: parseFloat(row.revenue ?? "0") || 0,
          quantitySold: parseFloat(row.quantity_sold ?? "0") || 0,
        })),
        dailyRevenueTrend: trendRows.rows.map((row: any) => ({
          period: row.period,
          revenue: parseFloat(row.revenue ?? "0") || 0,
        })),
      };
    }

    if (requestedSections.has("employeeSalesTable")) {
      response.employeeSalesTable = {
        rows: employeeRows,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: totalEmployees,
          totalPages: totalEmployees > 0 ? Math.ceil(totalEmployees / query.pageSize) : 0,
        },
        search: query.search,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      };
    }

    if (requestedSections.has("employeeDrillDowns")) {
      response.employeeDrillDowns = employeeDrillDowns;
    }

    return response;
  },

  async getAppointmentsDetail(
    salonId: string,
    dateType: string, from: string, to: string,
    statuses: string[],
  ) {
    const STATUS_MAP: Record<string, string> = {
      "Open": "booked", "Confirmed": "confirmed", "Checked-in": "in_progress",
      "Closed": "completed", "Cancelled": "cancelled", "No Show": "no_show",
      "Deleted": "cancelled",
    };
    const ALL_DB_STATUSES = ["booked", "confirmed", "in_progress", "completed", "cancelled", "no_show"];
    const dbStatuses = statuses
      .map(s => STATUS_MAP[s] ?? s.toLowerCase())
      .filter(Boolean);
    // Skip the status filter when all known statuses are covered (avoids array param issues)
    const coversAll = ALL_DB_STATUSES.every(s => dbStatuses.includes(s));
    const useStatusFilter = dbStatuses.length > 0 && !coversAll;

    const dateField    = dateType === "booking" ? "a.created_at" : "a.scheduled_at";
    const statusClause = useStatusFilter ? `AND a.status::text = ANY($4::text[])` : "";
    const params: any[] = [salonId, from, to];
    if (useStatusFilter) params.push(dbStatuses);

    const { rows } = await pool.query(
      `SELECT
         a.id                                               AS "id",
         TO_CHAR(a.scheduled_at, 'DD-MM-YYYY')              AS "appointmentDate",
         TO_CHAR(a.scheduled_at, 'HH12:MI AM')              AS "time",
         TO_CHAR(a.created_at,   'DD-MM-YYYY')              AS "bookedDate",
         COALESCE(c.full_name,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
         )                                                  AS "clientName",
         COALESCE(a.title,'Service')                        AS "serviceName",
         TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) AS "staffName",
         a.status                                           AS "status",
         a.duration_minutes                                 AS "duration",
         COALESCE(s.total_amount, 0)::numeric               AS "amount",
         COALESCE(s.payment_method, '')                     AS "paymentMethod",
         CASE WHEN s.id IS NOT NULL THEN 'paid' ELSE 'unpaid' END AS "paymentStatus"
       FROM appointments a
       LEFT JOIN clients  c  ON c.id  = a.client_id
       LEFT JOIN staff    st ON st.id = a.staff_id
       LEFT JOIN sales    s  ON s.appointment_id = a.id AND s.status = 'completed'
       WHERE a.salon_id = $1
         AND DATE(${dateField}) BETWEEN $2 AND $3
         ${statusClause}
       ORDER BY a.scheduled_at DESC
       LIMIT 500`,
      params,
    );
    return rows;
  },

  // ── Detail: Finance / Collections ────────────────────────────────────────────
  async getFinanceDetail(
    salonId: string, from: string, to: string, method: string,
  ) {
    const methodClause = method && method !== "All" ? `AND s.payment_method = $4` : "";
    const params: any[] = [salonId, from, to];
    if (method && method !== "All") params.push(method);

    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(s.created_at, 'YYYY-MM-DD')   AS date,
         COALESCE(s.invoice_number, s.id)       AS "ticketNo",
         COALESCE(c.full_name,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
         )                                      AS "clientName",
         COALESCE(s.notes,'Service')            AS service,
         s.total_amount                         AS amount,
         COALESCE(s.payment_method,'Cash')      AS "paymentMethod",
         TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) AS staff,
         COALESCE(br.name,'Main Branch')        AS center
       FROM sales s
       LEFT JOIN clients      c  ON c.id  = s.client_id
       LEFT JOIN staff        st ON st.id = s.staff_id
       LEFT JOIN appointments a  ON a.id  = s.appointment_id
       LEFT JOIN branches     br ON br.id = a.branch_id
       WHERE s.salon_id = $1
         AND DATE(s.created_at) BETWEEN $2 AND $3
         AND s.status = 'completed'
         ${methodClause}
       ORDER BY s.created_at DESC
       LIMIT 500`,
      params,
    );
    return rows;
  },

  // ── Detail: Employee ──────────────────────────────────────────────────────────
  async getEmployeeDetail(
    salonId: string, from: string, to: string, role: string, department: string = "All",
  ) {
    const roleClause = role && role !== "All"
      ? `AND LOWER(s.designation) ILIKE LOWER($4)` : "";
    const deptClause = department && department !== "All"
      ? `AND LOWER(s.department) ILIKE LOWER($${role && role !== "All" ? 5 : 4})` : "";
    const params: any[] = [salonId, from, to];
    if (role && role !== "All") params.push(role);
    if (department && department !== "All") params.push(department);

    const { rows } = await pool.query(
      `SELECT
         TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS name,
         COALESCE(s.designation,'Staff')       AS role,
         'General'                             AS department,
         COUNT(DISTINCT a.id)::int             AS "servicesPerformed",
         COALESCE(SUM(sl.total_amount),0)::int AS revenue,
         CASE WHEN COUNT(DISTINCT a.id) > 0
           THEN ROUND(COALESCE(SUM(sl.total_amount),0) / COUNT(DISTINCT a.id))::int
           ELSE 0 END                          AS "avgTicket",
         COUNT(DISTINCT a.id)::int             AS bookings,
         4.5::numeric                          AS rating,
         LEAST(ROUND(
           COUNT(DISTINCT a.id)::numeric
           / GREATEST(($3::date - $2::date), 1) / 8.0 * 100, 1
         )::numeric, 100)                      AS utilization
       FROM staff s
       LEFT JOIN appointments a
              ON a.staff_id = s.id AND a.salon_id = $1
             AND DATE(a.scheduled_at) BETWEEN $2 AND $3
             AND a.status::text = 'completed'
       LEFT JOIN sales sl
              ON sl.staff_id = s.id AND sl.salon_id = $1
             AND DATE(sl.created_at) BETWEEN $2 AND $3
             AND sl.status = 'completed'
       WHERE s.salon_id = $1 AND s.is_active = true
         ${roleClause}
         ${deptClause}
       GROUP BY s.id, s.first_name, s.last_name, s.designation
       ORDER BY revenue DESC`,
      params,
    );
    return rows;
  },

  // ── Detail: Inventory / Current Stock ────────────────────────────────────────
  async getInventoryDetail(salonId: string, category: string, status: string) {
    const catClause = category && category !== "All"
      ? `AND LOWER(p.name) ILIKE LOWER($2)` : "";
    const params: any[] = [salonId];
    if (category && category !== "All") params.push(`%${category}%`);

    const { rows } = await pool.query(
      `SELECT
         p.name                                        AS product,
         COALESCE(p.name, 'General')                   AS category,
         COALESCE(p.barcode, p.id::text)               AS sku,
         COALESCE(p.amount, 0)::int                    AS "currentStock",
         5                                             AS "reorderLevel",
         COALESCE(p.supply_price, 0)::numeric          AS "unitCost",
         (COALESCE(p.amount, 0) * COALESCE(p.supply_price, 0))::numeric AS "totalValue",
         CASE
           WHEN COALESCE(p.amount, 0) = 0 THEN 'Out of Stock'
           WHEN COALESCE(p.amount, 0) <= 5 THEN 'Low Stock'
           ELSE 'In Stock'
         END                                           AS status
       FROM products p
       WHERE p.salon_id = $1 ${catClause}
       ORDER BY p.name
       LIMIT 500`,
      params,
    );

    return status && status !== "All"
      ? rows.filter((r: any) => r.status === status)
      : rows;
  },

  // ── Detail: Payments (online / gateway) ──────────────────────────────────────
  async getPaymentsDetail(
    salonId: string, from: string, to: string, gateway: string, status: string,
  ) {
    // Map frontend display values → DB values for the status filter
    const dbStatusMap: Record<string, string> = {
      Success: "completed", Failed: "failed", Refunded: "refunded", Pending: "pending",
    };
    const dbStatus = status && status !== "All"
      ? (dbStatusMap[status] ?? status.toLowerCase()) : null;

    // payments table uses payment_method (no gateway column), payment_id as reference
    const gatewayClause = gateway && gateway !== "All"
      ? `AND LOWER(py.payment_method) = LOWER($4)` : "";
    const statusClause  = dbStatus
      ? `AND LOWER(COALESCE(py.status,'pending')) = $${gateway && gateway !== "All" ? 5 : 4}` : "";
    const params: any[] = [salonId, from, to];
    if (gateway && gateway !== "All") params.push(gateway);
    if (dbStatus) params.push(dbStatus);

    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(py.created_at, 'YYYY-MM-DD')                          AS date,
         py.payment_id                                                  AS "transactionId",
         COALESCE(c.full_name,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
         )                                                              AS "clientName",
         COALESCE(py.payment_method, 'Online')                         AS gateway,
         COALESCE(py.payment_method, 'Online')                         AS method,
         COALESCE(py.amount, py.net_amount, 0)::numeric                AS amount,
         CASE
           WHEN LOWER(COALESCE(py.status,'')) IN ('completed','success') THEN 'Success'
           WHEN LOWER(COALESCE(py.status,'')) = 'failed'                 THEN 'Failed'
           WHEN LOWER(COALESCE(py.status,'')) = 'refunded'               THEN 'Refunded'
           ELSE 'Pending'
         END                                                            AS status,
         py.payment_id                                                  AS "referenceNo"
       FROM payments py
       LEFT JOIN clients c ON c.id = py.client_id
       WHERE py.salon_id = $1
         AND DATE(py.created_at) BETWEEN $2 AND $3
         ${gatewayClause}
         ${statusClause}
       ORDER BY py.created_at DESC
       LIMIT 500`,
      params,
    );
    return rows;
  },

  // ── Detail: Daily Sales ───────────────────────────────────────────────────────
  async getDailyDetail(
    salonId: string, date: string, service: string, staff: string,
  ) {
    const serviceClause = service && service !== "All"
      ? `AND COALESCE(a.title,'') ILIKE $3` : "";
    const staffClause = staff && staff !== "All"
      ? `AND TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) ILIKE $${
          service && service !== "All" ? 4 : 3
        }` : "";
    const params: any[] = [salonId, date];
    if (service && service !== "All") params.push(`%${service}%`);
    if (staff   && staff   !== "All") params.push(`%${staff}%`);

    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(a.scheduled_at, 'HH24:MI')          AS time,
         a.id                                         AS "ticketNo",
         COALESCE(c.full_name,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
         )                                            AS "clientName",
         COALESCE(a.title, 'Service')                            AS service,
         TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')) AS staff,
         COALESCE(s.total_amount, 0)::numeric                   AS amount,
         COALESCE(s.payment_method, 'N/A')                      AS "paymentMethod",
         a.status
       FROM appointments a
       LEFT JOIN clients c  ON c.id  = a.client_id
       LEFT JOIN staff   st ON st.id = a.staff_id
       LEFT JOIN sales   s  ON s.appointment_id = a.id AND s.status = 'completed'
       WHERE a.salon_id = $1
         AND DATE(a.scheduled_at) = $2::date
         ${serviceClause}
         ${staffClause}
       ORDER BY a.scheduled_at ASC
       LIMIT 500`,
      params,
    );
    return rows;
  },

  // ── Detail: Marketing / Client Activity ──────────────────────────────────────
  async getMarketingDetail(
    salonId: string, from: string, to: string, status: string, search: string,
  ) {
    const statusClause = status && status !== "All"
      ? `AND c.is_active = $4` : "";
    const searchClause = search
      ? `AND (c.full_name ILIKE $${status && status !== "All" ? 5 : 4}
              OR c.first_name ILIKE $${status && status !== "All" ? 5 : 4}
              OR c.email      ILIKE $${status && status !== "All" ? 5 : 4}
              OR c.phone      ILIKE $${status && status !== "All" ? 5 : 4})` : "";
    const params: any[] = [salonId, from, to];
    if (status && status !== "All") params.push(status === "Active");
    if (search) params.push(`%${search}%`);

    const { rows } = await pool.query(
      `SELECT
         COALESCE(c.full_name,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))
         )                                            AS "clientName",
         COALESCE(c.email, '')                        AS email,
         COALESCE(c.phone, '')                        AS phone,
         COUNT(DISTINCT a.id)::int                    AS visits,
         TO_CHAR(MAX(a.scheduled_at), 'YYYY-MM-DD')  AS "lastVisit",
         COALESCE(SUM(s.total_amount), 0)::numeric    AS spend,
         CASE WHEN c.is_active THEN 'Active' ELSE 'Inactive' END AS status
       FROM clients c
       LEFT JOIN appointments a
              ON a.client_id = c.id AND a.salon_id = $1
             AND DATE(a.scheduled_at) BETWEEN $2 AND $3
             AND a.status = 'completed'
       LEFT JOIN sales s
              ON s.client_id = c.id AND s.salon_id = $1
             AND DATE(s.created_at) BETWEEN $2 AND $3
             AND s.status = 'completed'
       WHERE c.salon_id = $1
         ${statusClause}
         ${searchClause}
       GROUP BY c.id, c.full_name, c.first_name, c.last_name, c.email, c.phone, c.is_active
       ORDER BY spend DESC
       LIMIT 500`,
      params,
    );
    return rows;
  },

  // ── Export CSV data ───────────────────────────────────────────────────────────
  async getExportData(
    salonId: string, tab: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<{ headers: string[]; rows: (string | number)[][] }> {
    switch (tab) {
      case "revenue": {
        const d = await reportsRepository.getRevenue(salonId, period, from, to);
        return {
          headers: ["Label", "Revenue", "Target", "Previous"],
          rows:    d.trend.map(r => [r.label, r.revenue, r.target, r.prev]),
        };
      }
      case "appointments": {
        const d = await reportsRepository.getAppointments(salonId, {
          period,
          from,
          to,
          sortBy: "appointmentDate",
          sortOrder: "desc",
        });
        return {
          headers: ["Label", "Completed", "Cancelled", "No-Show"],
          rows:    d.appointmentVolume.map((r) => [r.label, r.completed, r.cancelled, r.noShow]),
        };
      }
      case "staff": {
        const d = await reportsRepository.getStaff(salonId, period, from, to);
        return {
          headers: ["Name", "Bookings", "Revenue (₹)", "Avg Ticket (₹)", "Utilization%"],
          rows:    d.performance.map(s => [s.name, s.bookings, s.revenue, s.avgTicket, s.utilization]),
        };
      }
      case "services": {
        const d = await reportsRepository.getServices(salonId, period, from, to);
        return {
          headers: ["Service", "Bookings", "Revenue (₹)", "Avg Ticket (₹)", "Growth%"],
          rows:    d.services.map(s => [s.name, s.bookings, s.revenue, s.avgTicket, s.growth]),
        };
      }
      case "clients": {
        const d = await reportsRepository.getClients(salonId, period, from, to);
        return {
          headers: ["Client", "Visits", "Spend (₹)"],
          rows:    d.topClients.map(c => [c.name, c.visits, c.spend]),
        };
      }
      default:
        return { headers: [], rows: [] };
    }
  },
};

