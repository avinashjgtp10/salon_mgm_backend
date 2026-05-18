import pool from "../../config/database";
import type {
  ReportPeriod,
  RevenueReport,
  AppointmentsReport,
  ClientsReport,
  StaffReport,
  ServicesReport,
  RevenueTrendPoint,
  AppointmentVolumePoint,
  ClientGrowthPoint,
  StaffPerformance,
  ServicePerformance,
} from "./reports.types";

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
    "7d":     { interval: "7 days",    prevInterval: "14 days",   trunc: "day",   labelFmt: "Dy",     numDays: 7   },
    "30d":    { interval: "30 days",   prevInterval: "60 days",   trunc: "day",   labelFmt: "DD Mon", numDays: 30  },
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
    const diffDays = Math.max(1, Math.round(diffMs / 86_400_000));
    const trunc    = diffDays <= 14 ? "day" : diffDays <= 90 ? "week" : "month";
    const labelFmt = trunc === "month" ? "Mon" : "DD Mon";
    return {
      startExpr: "$2::timestamptz",
      endExpr:   "$3::timestamptz",
      prevStart: "($2::timestamptz - ($3::timestamptz - $2::timestamptz))",
      prevEnd:   "$2::timestamptz",
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

// ── Repository ────────────────────────────────────────────────────────────────
export const reportsRepository = {

  // ── Revenue ─────────────────────────────────────────────────────────────────
  async getRevenue(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<RevenueReport> {
    const { startExpr, endExpr, prevStart, prevEnd, trunc, labelFmt, numDays, extraParams } =
      buildDateExprs(period, from, to);
    const p = [salonId, ...extraParams];

    const [curRows, prevRows, kpiRows, prevKpiRows] = await Promise.all([
      pool.query<{ label: string; bucket: string; revenue: string }>(
        `SELECT
           TO_CHAR(DATE_TRUNC('${trunc}', created_at), '${labelFmt}') AS label,
           DATE_TRUNC('${trunc}', created_at)::text                    AS bucket,
           COALESCE(SUM(total_amount), 0)::numeric                     AS revenue
         FROM sales
         WHERE salon_id = $1
           AND status = 'completed'
           AND created_at >= ${startExpr}
           AND created_at <  ${endExpr}
         GROUP BY DATE_TRUNC('${trunc}', created_at),
                  TO_CHAR(DATE_TRUNC('${trunc}', created_at), '${labelFmt}')
         ORDER BY DATE_TRUNC('${trunc}', created_at) ASC`,
        p,
      ),
      pool.query<{ bucket: string; prev_revenue: string }>(
        `SELECT
           DATE_TRUNC('${trunc}',
             created_at + (${endExpr} - ${startExpr})
           )::text                                              AS bucket,
           COALESCE(SUM(total_amount), 0)::numeric             AS prev_revenue
         FROM sales
         WHERE salon_id = $1
           AND status = 'completed'
           AND created_at >= ${prevStart}
           AND created_at <  ${prevEnd}
         GROUP BY DATE_TRUNC('${trunc}', created_at + (${endExpr} - ${startExpr}))
         ORDER BY bucket ASC`,
        p,
      ),
      pool.query<{ total: string; best_day: string }>(
        `SELECT
           COALESCE(SUM(d_total), 0)::numeric AS total,
           COALESCE(MAX(d_total), 0)::numeric  AS best_day
         FROM (
           SELECT SUM(total_amount) AS d_total
           FROM sales
           WHERE salon_id = $1
             AND status = 'completed'
             AND created_at >= ${startExpr}
             AND created_at <  ${endExpr}
           GROUP BY DATE(created_at)
         ) t`,
        p,
      ),
      pool.query<{ prev_total: string; prev_best_day: string }>(
        `SELECT
           COALESCE(SUM(d_total), 0)::numeric AS prev_total,
           COALESCE(MAX(d_total), 0)::numeric  AS prev_best_day
         FROM (
           SELECT SUM(total_amount) AS d_total
           FROM sales
           WHERE salon_id = $1
             AND status = 'completed'
             AND created_at >= ${prevStart}
             AND created_at <  ${prevEnd}
           GROUP BY DATE(created_at)
         ) t`,
        p,
      ),
    ]);

    const prevMap = new Map<string, number>(
      prevRows.rows.map(r => [r.bucket, parseFloat(r.prev_revenue)]),
    );

    const trend: RevenueTrendPoint[] = curRows.rows.map(row => {
      const rev  = parseFloat(row.revenue);
      const prev = prevMap.get(row.bucket) ?? 0;
      return { label: row.label.trim(), revenue: rev, target: r1(prev * 1.1), prev };
    });

    const k  = kpiRows.rows[0];
    const pk = prevKpiRows.rows[0];

    const totalRevenue    = parseFloat(k?.total        ?? "0");
    const bestDayRevenue  = parseFloat(k?.best_day     ?? "0");
    const avgDailyRevenue = r1(totalRevenue / numDays);
    const prevTotal       = parseFloat(pk?.prev_total    ?? "0");
    const prevBestDay     = parseFloat(pk?.prev_best_day ?? "0");
    const prevAvgDaily    = r1(prevTotal / numDays);
    const revenueTarget   = prevTotal > 1 ? prevTotal * 1.1 : 0;
    const targetAchieved  = revenueTarget > 0
      ? r1(Math.min((totalRevenue / revenueTarget) * 100, 200))
      : 100; // no prior data → show neutral 100%

    return {
      trend,
      kpi: {
        totalRevenue,
        avgDailyRevenue,
        bestDayRevenue,
        targetAchieved,
        changes: {
          totalRevenue:    pct(totalRevenue,    prevTotal),
          avgDailyRevenue: pct(avgDailyRevenue, prevAvgDaily),
          bestDayRevenue:  pct(bestDayRevenue,  prevBestDay),
          targetAchieved:  r1(targetAchieved - 100),
        },
      },
    };
  },

  // ── Appointments ─────────────────────────────────────────────────────────────
  async getAppointments(
    salonId: string, period: ReportPeriod, from?: string, to?: string,
  ): Promise<AppointmentsReport> {
    const { startExpr, endExpr, prevStart, prevEnd, trunc, labelFmt, extraParams } =
      buildDateExprs(period, from, to);
    const p = [salonId, ...extraParams];

    const [volRows, kpiRows, prevKpiRows, peakRows] = await Promise.all([
      pool.query<{ label: string; completed: string; cancelled: string; no_show: string }>(
        `SELECT
           TO_CHAR(DATE_TRUNC('${trunc}', scheduled_at), '${labelFmt}') AS label,
           COUNT(CASE WHEN status = 'completed' THEN 1 END)::int          AS completed,
           COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int          AS cancelled,
           COUNT(CASE WHEN status = 'no_show'   THEN 1 END)::int          AS no_show
         FROM appointments
         WHERE salon_id = $1
           AND scheduled_at >= ${startExpr}
           AND scheduled_at <  ${endExpr}
         GROUP BY DATE_TRUNC('${trunc}', scheduled_at),
                  TO_CHAR(DATE_TRUNC('${trunc}', scheduled_at), '${labelFmt}')
         ORDER BY DATE_TRUNC('${trunc}', scheduled_at) ASC`,
        p,
      ),
      pool.query<{ total: string; completed: string; cancelled: string }>(
        `SELECT
           COUNT(*)::int                                          AS total,
           COUNT(CASE WHEN status = 'completed' THEN 1 END)::int AS completed,
           COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int AS cancelled
         FROM appointments
         WHERE salon_id = $1
           AND scheduled_at >= ${startExpr}
           AND scheduled_at <  ${endExpr}`,
        p,
      ),
      pool.query<{ total: string; completed: string; cancelled: string }>(
        `SELECT
           COUNT(*)::int                                          AS total,
           COUNT(CASE WHEN status = 'completed' THEN 1 END)::int AS completed,
           COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int AS cancelled
         FROM appointments
         WHERE salon_id = $1
           AND scheduled_at >= ${prevStart}
           AND scheduled_at <  ${prevEnd}`,
        p,
      ),
      pool.query<{ hour: string; count: string }>(
        `SELECT
           EXTRACT(HOUR FROM scheduled_at)::int AS hour,
           COUNT(*)::int                        AS count
         FROM appointments
         WHERE salon_id = $1
           AND scheduled_at >= ${startExpr}
           AND scheduled_at <  ${endExpr}
         GROUP BY hour
         ORDER BY hour`,
        p,
      ),
    ]);

    const volume: AppointmentVolumePoint[] = volRows.rows.map(row => ({
      label:     row.label.trim(),
      completed: parseInt(row.completed, 10),
      cancelled: parseInt(row.cancelled, 10),
      noShow:    parseInt(row.no_show,   10),
    }));

    const k  = kpiRows.rows[0];
    const pk = prevKpiRows.rows[0];
    const total     = parseInt(k?.total     ?? "0", 10);
    const completed = parseInt(k?.completed ?? "0", 10);
    const cancelled = parseInt(k?.cancelled ?? "0", 10);
    const prevTotal = parseInt(pk?.total     ?? "0", 10);
    const prevCompleted = parseInt(pk?.completed ?? "0", 10);
    const prevCancelled = parseInt(pk?.cancelled ?? "0", 10);

    const completionRate     = total     > 0 ? r1((completed / total) * 100)         : 0;
    const cancellationRate   = total     > 0 ? r1((cancelled / total) * 100)         : 0;
    const prevCompletionRate = prevTotal > 0 ? r1((prevCompleted / prevTotal) * 100) : 0;
    const prevCancelRate     = prevTotal > 0 ? r1((prevCancelled / prevTotal) * 100) : 0;

    const HOUR_LABEL: Record<number, string> = {
      6:"6AM", 7:"7AM", 8:"8AM", 9:"9AM", 10:"10AM", 11:"11AM",
      12:"12PM", 13:"1PM", 14:"2PM", 15:"3PM", 16:"4PM",
      17:"5PM", 18:"6PM", 19:"7PM", 20:"8PM", 21:"9PM",
    };
    const peakHours = peakRows.rows
      .filter(r => HOUR_LABEL[parseInt(r.hour, 10)])
      .map(r => ({ hour: HOUR_LABEL[parseInt(r.hour, 10)], count: parseInt(r.count, 10) }));

    return {
      volume,
      peakHours,
      kpi: {
        totalBookings: total,
        completionRate,
        cancellationRate,
        avgDuration: 45,
        changes: {
          totalBookings:    pct(total,            prevTotal),
          completionRate:   pct(completionRate,   prevCompletionRate),
          cancellationRate: pct(cancellationRate, prevCancelRate),
          avgDuration:      0,
        },
      },
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

  // ── Detail: Appointments ──────────────────────────────────────────────────────
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
        const d = await reportsRepository.getAppointments(salonId, period, from, to);
        return {
          headers: ["Label", "Completed", "Cancelled", "No-Show"],
          rows:    d.volume.map(r => [r.label, r.completed, r.cancelled, r.noShow]),
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
