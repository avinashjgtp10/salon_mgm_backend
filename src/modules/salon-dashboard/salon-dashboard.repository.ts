import pool from "../../config/database";
import { notificationsRepository } from "../notifications/notifications.repository";
import type {
  DashboardSummary,
  TodayAppointment,
  RevenueDataPoint,
  TopStaffMember,
  StaffRevenueEntry,
  ServiceMixItem,
  DashboardService,
  DashboardAll,
  TodayOverview,
  TimelineSlot,
  PendingPayments,
  TodaysBirthdays,
  InactiveClients,
  ActivityItem,
} from "./salon-dashboard.types";

// Map appointment status → frontend display status. The appointments table's
// own `status` column is only ever flipped to 'completed' if staff manually
// do so — most salons never bother once the bill is paid — so a booked/
// confirmed appointment that's actually been paid in full is treated as
// completed too. Same payments-table-is-authoritative convention used in
// clients.controller.ts's payment_status derivation.
function mapStatus(
  s: string,
  isFullyPaid: boolean
): "completed" | "in-progress" | "upcoming" | "cancelled" | "no-show" {
  switch (s) {
    case "completed":
      return "completed";
    case "in_progress":
      return "in-progress";
    case "cancelled":
      return "cancelled";
    case "no_show":
      return "no-show";
    default:
      return isFullyPaid ? "completed" : "upcoming"; // booked, confirmed
  }
}

// Round a number to 1 decimal place
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const salonDashboardRepository = {
  // ── KPI Summary ─────────────────────────────────────────────────────────────
  async getSummary(salonId: string): Promise<DashboardSummary> {
    const [revenueRows, apptRows, clientRows, newClientRows, allTimeRevenueRows] = await Promise.all([
      // Revenue: this month, last month, today, yesterday — plus completed-sale
      // counts for avg bill value (this month vs last month, for a real % change).
      pool.query<{
        total_revenue: string;
        last_month_revenue: string;
        today_revenue: string;
        last_month_today_revenue: string;
        yesterday_revenue: string;
        sales_count: string;
        last_month_sales_count: string;
      }>(
        `SELECT
           COALESCE(SUM(CASE WHEN date_trunc('month', created_at) = date_trunc('month', NOW())
             THEN total_amount ELSE 0 END), 0)::numeric AS total_revenue,
           COALESCE(SUM(CASE WHEN date_trunc('month', created_at) = date_trunc('month', NOW() - INTERVAL '1 month')
             THEN total_amount ELSE 0 END), 0)::numeric AS last_month_revenue,
           COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE
             THEN total_amount ELSE 0 END), 0)::numeric AS today_revenue,
           COALESCE(SUM(CASE WHEN DATE(created_at) = (CURRENT_DATE - INTERVAL '1 month')::date
             THEN total_amount ELSE 0 END), 0)::numeric AS last_month_today_revenue,
           COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'
             THEN total_amount ELSE 0 END), 0)::numeric AS yesterday_revenue,
           COUNT(CASE WHEN date_trunc('month', created_at) = date_trunc('month', NOW()) THEN 1 END) AS sales_count,
           COUNT(CASE WHEN date_trunc('month', created_at) = date_trunc('month', NOW() - INTERVAL '1 month') THEN 1 END) AS last_month_sales_count
         FROM sales
         WHERE salon_id = $1
           AND status = 'completed'
           AND created_at >= date_trunc('month', NOW() - INTERVAL '1 month')`,
        [salonId]
      ),

      // Appointments: this month, last month, today
      pool.query<{
        total_appointments: string;
        last_month_appointments: string;
        today_appointments: string;
      }>(
        `SELECT
           COUNT(CASE WHEN date_trunc('month', scheduled_at) = date_trunc('month', NOW())
             THEN 1 END) AS total_appointments,
           COUNT(CASE WHEN date_trunc('month', scheduled_at) = date_trunc('month', NOW() - INTERVAL '1 month')
             THEN 1 END) AS last_month_appointments,
           COUNT(CASE WHEN DATE(scheduled_at) = CURRENT_DATE
             THEN 1 END) AS today_appointments
         FROM appointments
         WHERE salon_id = $1
           AND deleted_at IS NULL
           AND status NOT IN ('cancelled', 'no_show')
           AND scheduled_at >= date_trunc('month', NOW() - INTERVAL '1 month')`,
        [salonId]
      ),

      // Active clients who have ever visited this salon (clients table has no salon_id)
      pool.query<{ total_clients: string }>(
        `SELECT COUNT(DISTINCT c.id) AS total_clients
         FROM clients c
         INNER JOIN (
           SELECT client_id FROM appointments WHERE salon_id = $1 AND client_id IS NOT NULL AND deleted_at IS NULL
           UNION
           SELECT client_id FROM sales       WHERE salon_id = $1 AND client_id IS NOT NULL
         ) visited ON visited.client_id = c.id
         WHERE c.is_active = true`,
        [salonId]
      ),

      // New clients — a client's first-ever appointment/sale at THIS salon fell
      // today / this month. (clients table has no salon_id, so "new to this
      // salon" is derived from their earliest interaction here, same pattern
      // as the active-clients query above.)
      pool.query<{ new_today: string; new_this_month: string }>(
        `WITH first_visit AS (
           SELECT client_id, MIN(created_at) AS first_at
           FROM (
             SELECT client_id, created_at FROM appointments WHERE salon_id = $1 AND client_id IS NOT NULL AND deleted_at IS NULL
             UNION ALL
             SELECT client_id, created_at FROM sales       WHERE salon_id = $1 AND client_id IS NOT NULL
           ) combined
           GROUP BY client_id
         )
         SELECT
           COUNT(*) FILTER (WHERE DATE(first_at) = CURRENT_DATE) AS new_today,
           COUNT(*) FILTER (WHERE date_trunc('month', first_at) = date_trunc('month', NOW())) AS new_this_month
         FROM first_visit`,
        [salonId]
      ),

      // All-time total revenue — genuinely unbounded, unlike total_revenue
      // above which is scoped to the current calendar month.
      pool.query<{ all_time_revenue: string }>(
        `SELECT COALESCE(SUM(total_amount), 0)::numeric AS all_time_revenue
         FROM sales
         WHERE salon_id = $1 AND status = 'completed'`,
        [salonId]
      ),
    ]);

    const r = revenueRows.rows[0];
    const a = apptRows.rows[0];
    const nc = newClientRows.rows[0];

    const totalRevenue = parseFloat(r.total_revenue);
    const allTimeRevenue = parseFloat(allTimeRevenueRows.rows[0]?.all_time_revenue ?? "0");
    const lastMonthRevenue = parseFloat(r.last_month_revenue);
    const todayRevenue = parseFloat(r.today_revenue);
    const lastMonthTodayRevenue = parseFloat(r.last_month_today_revenue);
    const yesterdayRevenue = parseFloat(r.yesterday_revenue);

    const totalAppointments = parseInt(a.total_appointments, 10);
    const lastMonthAppointments = parseInt(a.last_month_appointments, 10);
    const totalClients = parseInt(clientRows.rows[0].total_clients, 10);
    const todayAppointmentsCount = parseInt(a.today_appointments, 10);

    const newClientsToday = parseInt(nc?.new_today ?? "0", 10);
    const newClientsThisMonth = parseInt(nc?.new_this_month ?? "0", 10);

    const salesCount = parseInt(r.sales_count, 10);
    const lastMonthSalesCount = parseInt(r.last_month_sales_count, 10);
    const avgBillValue = salesCount > 0 ? round1(totalRevenue / salesCount) : 0;
    const lastMonthAvgBillValue = lastMonthSalesCount > 0 ? lastMonthRevenue / lastMonthSalesCount : 0;

    // Percentage changes (null when last-month baseline is 0)
    const pctChange = (curr: number, prev: number): number | null => {
      if (prev === 0) return curr > 0 ? 100 : null;
      return round1(((curr - prev) / prev) * 100);
    };

    return {
      totalRevenue,
      allTimeRevenue,
      lastMonthRevenue,
      yesterdayRevenue,
      newClientsToday,
      newClientsThisMonth,
      totalAppointments,
      totalClients,
      todayRevenue,
      revenueChange: pctChange(totalRevenue, lastMonthRevenue),
      appointmentsChange: pctChange(totalAppointments, lastMonthAppointments),
      clientsChange: null, // no last-month baseline available here
      todayRevenueChange: pctChange(todayRevenue, lastMonthTodayRevenue),
      todayAppointmentsCount,
      avgBillValue,
      avgBillValueChange: pctChange(avgBillValue, lastMonthAvgBillValue),
    };
  },

  // ── Today's Appointments ─────────────────────────────────────────────────────
  async getTodayAppointments(salonId: string, date?: string | null): Promise<TodayAppointment[]> {
    const { rows } = await pool.query<{
      id: string;
      client_name: string;
      service: string;
      staff_name: string;
      time: string;
      status: string;
      amount: string;
      is_fully_paid: boolean;
      is_deleted: boolean;
    }>(
      `SELECT
         a.id,
         COALESCE(
           c.full_name,
           TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
         ) AS client_name,
         COALESCE(a.title, 'Service') AS service,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
         TO_CHAR(a.scheduled_at AT TIME ZONE 'UTC', 'HH12:MI AM') AS time,
         a.status,
         COALESCE(
           (SELECT ROUND(
              SUM((item->>'price')::numeric * COALESCE((item->>'quantity')::numeric, 1)),
              2
            )
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
            ) AS item),
           0
         )::numeric AS amount,
         COALESCE(
           (SELECT bool_or(p.status = 'completed') FROM payments p WHERE p.appointment_id = a.id),
           false
         ) AS is_fully_paid,
         (a.deleted_at IS NOT NULL) AS is_deleted
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN staff  s ON s.id = a.staff_id
       WHERE a.salon_id = $1
         AND DATE(a.scheduled_at AT TIME ZONE 'UTC') = COALESCE($2::date, CURRENT_DATE)
       ORDER BY a.scheduled_at ASC`,
      [salonId, date ?? null]
    );

    return rows.map((row) => ({
      id: row.id,
      clientName: row.client_name || "Walk-in",
      service: row.service,
      staffName: row.staff_name || "—",
      time: row.time,
      status: row.is_deleted ? "deleted" : mapStatus(row.status, row.is_fully_paid),
      amount: parseFloat(row.amount),
    }));
  },

  // ── Revenue Chart (today / weekly / monthly / yearly) ───────────────────────
  async getRevenueChart(salonId: string, period: string = "monthly"): Promise<RevenueDataPoint[]> {
    let sql: string;

    if (period === "today") {
      sql = `
        SELECT
          TO_CHAR(date_trunc('hour', created_at AT TIME ZONE 'UTC'), 'HH12AM') AS month,
          date_trunc('hour', created_at AT TIME ZONE 'UTC')                     AS sort_key,
          COALESCE(SUM(total_amount), 0)::numeric                               AS revenue
        FROM sales
        WHERE salon_id = $1
          AND status = 'completed'
          AND DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
        GROUP BY date_trunc('hour', created_at AT TIME ZONE 'UTC')
        ORDER BY sort_key ASC`;
    } else if (period === "weekly") {
      sql = `
        SELECT
          TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'Dy DD') AS month,
          DATE(created_at AT TIME ZONE 'UTC')                    AS sort_key,
          COALESCE(SUM(total_amount), 0)::numeric                AS revenue
        FROM sales
        WHERE salon_id = $1
          AND status = 'completed'
          AND created_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY sort_key ASC`;
    } else if (period === "yearly") {
      sql = `
        SELECT
          TO_CHAR(date_trunc('month', created_at), 'Mon YY') AS month,
          date_trunc('month', created_at)                     AS sort_key,
          COALESCE(SUM(total_amount), 0)::numeric             AS revenue
        FROM sales
        WHERE salon_id = $1
          AND status = 'completed'
          AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY date_trunc('month', created_at)
        ORDER BY sort_key ASC`;
    } else {
      // monthly — daily data for the current calendar month
      sql = `
        SELECT
          TO_CHAR(DATE(created_at AT TIME ZONE 'UTC'), 'DD') AS month,
          DATE(created_at AT TIME ZONE 'UTC')                 AS sort_key,
          COALESCE(SUM(total_amount), 0)::numeric             AS revenue
        FROM sales
        WHERE salon_id = $1
          AND status = 'completed'
          AND date_trunc('month', created_at AT TIME ZONE 'UTC') = date_trunc('month', NOW() AT TIME ZONE 'UTC')
        GROUP BY DATE(created_at AT TIME ZONE 'UTC')
        ORDER BY sort_key ASC`;
    }

    const { rows } = await pool.query<{ month: string; revenue: string }>(sql, [salonId]);

    return rows.map((row) => ({
      month: row.month,
      revenue: parseFloat(row.revenue),
      expenses: 0,
    }));
  },

  // ── Staff Revenue (donut) — same period semantics as getRevenueChart ───────
  async getStaffRevenue(salonId: string, period: string = "monthly"): Promise<StaffRevenueEntry[]> {
    let dateCond: string;
    if (period === "today") {
      dateCond = `DATE(sl.created_at AT TIME ZONE 'UTC') = CURRENT_DATE`;
    } else if (period === "weekly") {
      dateCond = `sl.created_at >= CURRENT_DATE - INTERVAL '6 days'`;
    } else if (period === "yearly") {
      dateCond = `sl.created_at >= NOW() - INTERVAL '12 months'`;
    } else {
      dateCond = `date_trunc('month', sl.created_at AT TIME ZONE 'UTC') = date_trunc('month', NOW() AT TIME ZONE 'UTC')`;
    }

    const { rows } = await pool.query<{ id: string; name: string; role: string; revenue: string }>(
      `SELECT
         s.id,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS name,
         COALESCE(s.designation, 'Staff') AS role,
         COALESCE(SUM(sl.total_amount), 0)::numeric AS revenue
       FROM staff s
       LEFT JOIN sales sl
              ON sl.staff_id = s.id
             AND sl.status = 'completed'
             AND ${dateCond}
       WHERE s.salon_id = $1
         AND s.is_active = true
       GROUP BY s.id, s.first_name, s.last_name, s.designation
       HAVING COALESCE(SUM(sl.total_amount), 0) > 0
       ORDER BY revenue DESC
       LIMIT 8`,
      [salonId]
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name || "Unknown",
      role: row.role,
      revenue: parseFloat(row.revenue),
    }));
  },

  // ── Top Staff by Revenue ────────────────────────────────────────────────────
  async getTopStaff(salonId: string): Promise<TopStaffMember[]> {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      role: string;
      avatar: string;
      client_count: string;
      revenue: string;
      bookings: string;
    }>(
      `WITH appt_stats AS (
         SELECT staff_id,
                COUNT(DISTINCT client_id) AS client_count,
                COUNT(DISTINCT id)        AS bookings
         FROM appointments
         WHERE salon_id = $1
           AND deleted_at IS NULL
           AND date_trunc('month', scheduled_at) = date_trunc('month', NOW())
           AND status = 'completed'
         GROUP BY staff_id
       ),
       sales_stats AS (
         SELECT staff_id,
                COALESCE(SUM(total_amount), 0)::numeric AS revenue
         FROM sales
         WHERE salon_id = $1
           AND date_trunc('month', created_at) = date_trunc('month', NOW())
           AND status = 'completed'
         GROUP BY staff_id
       )
       SELECT
         s.id,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS name,
         COALESCE(s.designation, 'Staff') AS role,
         UPPER(
           LEFT(COALESCE(s.first_name, '?'), 1) ||
           LEFT(COALESCE(s.last_name,  '?'), 1)
         ) AS avatar,
         COALESCE(appt_stats.client_count, 0) AS client_count,
         COALESCE(sales_stats.revenue, 0)     AS revenue,
         COALESCE(appt_stats.bookings, 0)     AS bookings
       FROM staff s
       LEFT JOIN appt_stats  ON appt_stats.staff_id  = s.id
       LEFT JOIN sales_stats ON sales_stats.staff_id = s.id
       WHERE s.salon_id = $1
         AND s.is_active = true
       ORDER BY revenue DESC, client_count DESC
       LIMIT 10`,
      [salonId]
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name || "Unknown",
      role: row.role,
      avatar: row.avatar,
      clientCount: parseInt(row.client_count, 10),
      revenue: parseFloat(row.revenue),
      bookings: parseInt(row.bookings, 10),
    }));
  },

  // ── Service Mix ──────────────────────────────────────────────────────────────
  async getServiceMix(salonId: string): Promise<ServiceMixItem[]> {
    const { rows } = await pool.query<{
      name: string;
      booking_count: string;
    }>(
      `SELECT
         (item->>'name') AS name,
         COUNT(*)::int    AS booking_count
       FROM appointments a,
            jsonb_array_elements(
              CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END
            ) AS item
       WHERE a.salon_id = $1
         AND a.deleted_at IS NULL
         AND date_trunc('month', a.scheduled_at) = date_trunc('month', NOW())
         AND a.status = 'completed'
         AND (item->>'name') IS NOT NULL
         AND (item->>'name') != ''
       GROUP BY (item->>'name')
       ORDER BY booking_count DESC
       LIMIT 10`,
      [salonId]
    );

    if (rows.length === 0) return [];

    const total = rows.reduce((sum, r) => sum + parseInt(r.booking_count, 10), 0);

    return rows.map((row) => ({
      name: row.name,
      value: round1((parseInt(row.booking_count, 10) / total) * 100),
    }));
  },

  // ── Active Services catalog ──────────────────────────────────────────────────
  async getServices(salonId: string): Promise<DashboardService[]> {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      price: string;
      duration: string;
      category_name: string | null;
      price_type: string | null;
      is_active: boolean;
    }>(
      `SELECT
         s.id,
         s.name,
         COALESCE(s.price::text, '0')          AS price,
         COALESCE(s.duration_minutes, 0)       AS duration,
         c.name                                AS category_name,
         s.price_type,
         s.is_active
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.salon_id = $1
         AND s.is_active = true
       ORDER BY s.name ASC`,
      [salonId]
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      duration: parseInt(String(row.duration), 10),
      category_name: row.category_name ?? null,
      price_type: (row.price_type as DashboardService["price_type"]) ?? null,
      is_active: row.is_active,
    }));
  },

  // ── Today's Overview (bookings/waiting/delayed/payment-due counts) ─────────
  async getTodayOverview(salonId: string): Promise<TodayOverview> {
    const { rows } = await pool.query<{
      bookings: string;
      waiting: string;
      delayed: string;
      payment_due: string;
    }>(
      // appointments.due_amount is never actually written anywhere in the
      // backend — the real due amount lives on the most recent payments row
      // per appointment (see getPendingPayments above for the same fix).
      `SELECT
         COUNT(*) FILTER (WHERE a.status NOT IN ('cancelled', 'no_show'))
           AS bookings,
         COUNT(*) FILTER (WHERE a.status IN ('booked', 'confirmed') AND a.scheduled_at > NOW())
           AS waiting,
         COUNT(*) FILTER (WHERE a.status IN ('booked', 'confirmed') AND a.scheduled_at <= NOW())
           AS delayed,
         COUNT(*) FILTER (WHERE COALESCE(latest.due_amount, 0) > 0)
           AS payment_due
       FROM appointments a
       LEFT JOIN LATERAL (
         SELECT p.due_amount FROM payments p
         WHERE p.appointment_id = a.id
         ORDER BY p.created_at DESC LIMIT 1
       ) latest ON true
       WHERE a.salon_id = $1
         AND DATE(a.scheduled_at AT TIME ZONE 'UTC') = CURRENT_DATE
         AND a.deleted_at IS NULL`,
      [salonId]
    );
    const row = rows[0];
    const delayed = parseInt(row?.delayed ?? "0", 10);
    return {
      bookings: parseInt(row?.bookings ?? "0", 10),
      waiting: parseInt(row?.waiting ?? "0", 10),
      delayed,
      paymentDue: parseInt(row?.payment_due ?? "0", 10),
      runningLate: delayed,
    };
  },

  // ── Today's Timeline — appointment count per hour, business hours only ─────
  async getTodayTimeline(salonId: string): Promise<TimelineSlot[]> {
    const { rows } = await pool.query<{ hour: string; count: string }>(
      `SELECT
         TO_CHAR(date_trunc('hour', scheduled_at AT TIME ZONE 'UTC'), 'HH12 AM') AS hour,
         date_trunc('hour', scheduled_at AT TIME ZONE 'UTC')                      AS sort_key,
         COUNT(*)::int                                                            AS count
       FROM appointments
       WHERE salon_id = $1
         AND DATE(scheduled_at AT TIME ZONE 'UTC') = CURRENT_DATE
         AND status NOT IN ('cancelled', 'no_show')
         AND deleted_at IS NULL
       GROUP BY date_trunc('hour', scheduled_at AT TIME ZONE 'UTC')
       ORDER BY sort_key ASC`,
      [salonId]
    );
    return rows.map((row) => ({ hour: row.hour.replace(/^0/, ""), count: parseInt(row.count, 10) }));
  },

  // ── Pending Payments — all outstanding balances, not just today's slate ─────
  // appointments.due_amount is never actually written anywhere in the backend
  // (checked every INSERT/UPDATE touching the appointments table — none set
  // it), so it's permanently 0/NULL. The real, authoritative due amount is the
  // most recent payment row per appointment (same pattern used everywhere else
  // in this codebase, e.g. clients.controller.ts's payment_status derivation).
  async getPendingPayments(salonId: string): Promise<PendingPayments> {
    const { rows } = await pool.query<{ cnt: string; amount: string }>(
      `SELECT COUNT(DISTINCT a.client_id)::int AS cnt, COALESCE(SUM(latest.due_amount), 0)::numeric AS amount
       FROM appointments a
       CROSS JOIN LATERAL (
         SELECT p.due_amount FROM payments p
         WHERE p.appointment_id = a.id
         ORDER BY p.created_at DESC LIMIT 1
       ) latest
       WHERE a.salon_id = $1
         AND a.deleted_at IS NULL
         AND a.client_id IS NOT NULL
         AND latest.due_amount > 0`,
      [salonId]
    );
    return { count: parseInt(rows[0]?.cnt ?? "0", 10), amount: parseFloat(rows[0]?.amount ?? "0") };
  },

  // ── Today's Birthdays ────────────────────────────────────────────────────────
  // birthday_day_month is stored as "MM-DD" (see clients.types.ts).
  async getTodaysBirthdays(salonId: string): Promise<TodaysBirthdays> {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT c.id, COALESCE(c.full_name, TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS name
       FROM clients c
       INNER JOIN (
         SELECT client_id FROM appointments WHERE salon_id = $1 AND client_id IS NOT NULL AND deleted_at IS NULL
         UNION
         SELECT client_id FROM sales       WHERE salon_id = $1 AND client_id IS NOT NULL
       ) visited ON visited.client_id = c.id
       WHERE c.is_active = true
         AND c.birthday_day_month IS NOT NULL
         AND (
           -- Intended format is "MM-DD" (5 chars) — but most existing rows were
           -- populated by the CSV/Excel import path, which stores the raw
           -- imported value verbatim as "DD-MM-YYYY" (10 chars) instead of
           -- reformatting it. Match "day-month" out of whichever shape is
           -- actually stored rather than assuming only the intended one.
           (LENGTH(c.birthday_day_month) = 5  AND c.birthday_day_month        = TO_CHAR(NOW(), 'MM-DD'))
           OR
           (LENGTH(c.birthday_day_month) = 10 AND LEFT(c.birthday_day_month, 5) = TO_CHAR(NOW(), 'DD-MM'))
         )`,
      [salonId]
    );
    return { count: rows.length, clients: rows.map((r) => ({ id: r.id, name: r.name || "Unknown" })) };
  },

  // ── Inactive Clients — visited before, nothing in the last 30 days ──────────
  async getInactiveClients(salonId: string): Promise<InactiveClients> {
    const { rows } = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::int AS cnt
       FROM clients c
       WHERE c.is_active = true
         AND EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.client_id = c.id AND a.salon_id = $1 AND a.deleted_at IS NULL
             AND a.status NOT IN ('cancelled', 'no_show')
         )
         AND NOT EXISTS (
           SELECT 1 FROM appointments a2
           WHERE a2.client_id = c.id AND a2.salon_id = $1 AND a2.deleted_at IS NULL
             AND a2.status NOT IN ('cancelled', 'no_show')
             AND a2.scheduled_at >= NOW() - INTERVAL '30 days'
         )`,
      [salonId]
    );
    return { count: parseInt(rows[0]?.cnt ?? "0", 10) };
  },

  // ── Recent Activity — reuses the same feed backing the notification bell ───
  async getRecentActivity(salonId: string): Promise<ActivityItem[]> {
    const rows = await notificationsRepository.listBySalon(salonId, 6);
    return rows.map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body, createdAt: n.created_at,
    }));
  },

  // ── Combined: all dashboard data in one call ────────────────────────────────
  // Each sub-query is isolated — a DB timeout or slow query on one section
  // returns a safe empty/zero default instead of crashing the entire response.
  async getAll(salonId: string, period: string = "monthly", date?: string): Promise<DashboardAll> {
    const safe = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback);

    const defaultSummary: DashboardSummary = {
      totalRevenue: 0, allTimeRevenue: 0, totalAppointments: 0, totalClients: 0,
      todayRevenue: 0, revenueChange: null, appointmentsChange: null,
      clientsChange: null, todayRevenueChange: null, todayAppointmentsCount: 0,
      avgBillValue: 0, avgBillValueChange: null,
      lastMonthRevenue: 0, yesterdayRevenue: 0, newClientsToday: 0, newClientsThisMonth: 0,
    };
    const defaultOverview: TodayOverview = { bookings: 0, waiting: 0, delayed: 0, paymentDue: 0, runningLate: 0 };
    const defaultPending: PendingPayments = { count: 0, amount: 0 };
    const defaultBirthdays: TodaysBirthdays = { count: 0, clients: [] };
    const defaultInactive: InactiveClients = { count: 0 };

    const [
      summary, todayAppointments, revenueChart, topStaff, serviceMix, services,
      todayOverview, todayTimeline, pendingPayments, todaysBirthdays, inactiveClients, recentActivity,
    ] = await Promise.all([
      safe(this.getSummary(salonId),           defaultSummary),
      safe(this.getTodayAppointments(salonId, date), []),
      safe(this.getRevenueChart(salonId, period),    []),
      safe(this.getTopStaff(salonId),          []),
      safe(this.getServiceMix(salonId),         []),
      safe(this.getServices(salonId),           []),
      safe(this.getTodayOverview(salonId),      defaultOverview),
      safe(this.getTodayTimeline(salonId),      []),
      safe(this.getPendingPayments(salonId),    defaultPending),
      safe(this.getTodaysBirthdays(salonId),    defaultBirthdays),
      safe(this.getInactiveClients(salonId),    defaultInactive),
      safe(this.getRecentActivity(salonId),     []),
    ]);

    return {
      summary, todayAppointments, revenueChart, topStaff, serviceMix, services,
      todayOverview, todayTimeline, pendingPayments, todaysBirthdays, inactiveClients, recentActivity,
    };
  },
};
