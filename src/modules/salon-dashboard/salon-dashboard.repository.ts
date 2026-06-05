import pool from "../../config/database";
import type {
  DashboardSummary,
  TodayAppointment,
  RevenueDataPoint,
  TopStaffMember,
  ServiceMixItem,
  DashboardService,
  DashboardAll,
} from "./salon-dashboard.types";

// Map appointment status → frontend display status
function mapStatus(
  s: string
): "completed" | "in-progress" | "upcoming" | "cancelled" {
  switch (s) {
    case "completed":
      return "completed";
    case "in_progress":
      return "in-progress";
    case "cancelled":
    case "no_show":
      return "cancelled";
    default:
      return "upcoming"; // booked, confirmed
  }
}

// Round a number to 1 decimal place
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const salonDashboardRepository = {
  // ── KPI Summary ─────────────────────────────────────────────────────────────
  async getSummary(salonId: string, date?: string): Promise<DashboardSummary> {
    const [revenueRows, apptRows, clientRows, extendedRows] = await Promise.all([
      // Revenue: this month, last month, today, product sales today
      pool.query<{
        total_revenue: string;
        last_month_revenue: string;
        today_revenue: string;
        last_month_today_revenue: string;
        today_product_revenue: string;
        last_month_today_product_revenue: string;
      }>(
        `SELECT
           COALESCE(SUM(CASE WHEN date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date))
             THEN total_amount ELSE 0 END), 0)::numeric AS total_revenue,
           COALESCE(SUM(CASE WHEN date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - INTERVAL '1 month')
             THEN total_amount ELSE 0 END), 0)::numeric AS last_month_revenue,
           COALESCE(SUM(CASE WHEN DATE(created_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
             THEN total_amount ELSE 0 END), 0)::numeric AS today_revenue,
           COALESCE(SUM(CASE WHEN DATE(created_at AT TIME ZONE 'Asia/Kolkata') = (COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - INTERVAL '1 month')::date
             THEN total_amount ELSE 0 END), 0)::numeric AS last_month_today_revenue,
           COALESCE((
             SELECT SUM(si.total_price::numeric)
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE s.salon_id = $1
               AND s.status = 'completed'
               AND si.item_type = 'product'
               AND DATE(s.created_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
           ), 0)::numeric AS today_product_revenue,
           COALESCE((
             SELECT SUM(si.total_price::numeric)
             FROM sale_items si
             INNER JOIN sales s ON s.id = si.sale_id
             WHERE s.salon_id = $1
               AND s.status = 'completed'
               AND si.item_type = 'product'
               AND DATE(s.created_at AT TIME ZONE 'Asia/Kolkata') = (COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - INTERVAL '1 month')::date
           ), 0)::numeric AS last_month_today_product_revenue
         FROM sales
         WHERE salon_id = $1
           AND status = 'completed'
           AND created_at AT TIME ZONE 'Asia/Kolkata' >= date_trunc('month', COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - INTERVAL '1 month')`,
        [salonId, date ?? null]
      ),

      // Appointments: this month, last month, today
      pool.query<{
        total_appointments: string;
        last_month_appointments: string;
        today_appointments: string;
      }>(
        `SELECT
           COUNT(CASE WHEN date_trunc('month', scheduled_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date))
             THEN 1 END) AS total_appointments,
           COUNT(CASE WHEN date_trunc('month', scheduled_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - INTERVAL '1 month')
             THEN 1 END) AS last_month_appointments,
           COUNT(CASE WHEN DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
             THEN 1 END) AS today_appointments
         FROM appointments
         WHERE salon_id = $1
           AND status NOT IN ('cancelled', 'no_show')
           AND scheduled_at AT TIME ZONE 'Asia/Kolkata' >= date_trunc('month', COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - INTERVAL '1 month')`,
        [salonId, date ?? null]
      ),

      // Active clients who have ever visited this salon (clients table has no salon_id)
      pool.query<{ total_clients: string }>(
        `SELECT COUNT(DISTINCT c.id) AS total_clients
         FROM clients c
         INNER JOIN (
           SELECT client_id FROM appointments WHERE salon_id = $1 AND client_id IS NOT NULL
           UNION
           SELECT client_id FROM sales       WHERE salon_id = $1 AND client_id IS NOT NULL
         ) visited ON visited.client_id = c.id
         WHERE c.is_active = true`,
        [salonId]
      ),

      // Extended KPIs: today clients, yesterday stats, pending clients, pending amount
      pool.query<{
        today_clients: string;
        yesterday_revenue: string;
        yesterday_appointments: string;
        yesterday_clients: string;
        pending_clients: string;
        pending_amount: string;
      }>(
        `SELECT 
          (
            (SELECT COUNT(DISTINCT client_id) FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AND client_id IS NOT NULL)
            +
            (SELECT COUNT(*) FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AND client_id IS NULL)
            +
            (SELECT COUNT(DISTINCT client_id) FROM sales WHERE salon_id = $1 AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AND client_id IS NOT NULL
             AND client_id NOT IN (
               SELECT client_id FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AND client_id IS NOT NULL
             ))
          ) AS today_clients,
          (SELECT COALESCE(SUM(total_amount), 0) FROM sales WHERE salon_id = $1 AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - 1 AND status = 'completed')::numeric AS yesterday_revenue,
          (SELECT COUNT(*) FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - 1 AND status NOT IN ('cancelled', 'no_show')) AS yesterday_appointments,
          (
            (SELECT COUNT(DISTINCT client_id) FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - 1 AND client_id IS NOT NULL)
            +
            (SELECT COUNT(*) FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - 1 AND client_id IS NULL)
            +
            (SELECT COUNT(DISTINCT client_id) FROM sales WHERE salon_id = $1 AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - 1 AND client_id IS NOT NULL
             AND client_id NOT IN (
               SELECT client_id FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) - 1 AND client_id IS NOT NULL
             ))
          ) AS yesterday_clients,
          (SELECT COUNT(*) FROM appointments WHERE salon_id = $1 AND DATE(scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AND status NOT IN ('completed', 'cancelled', 'no_show', 'in_progress')) AS pending_clients,
          COALESCE((
            SELECT SUM(
              COALESCE((
                SELECT ROUND(SUM((item->>'price')::numeric * COALESCE((item->>'quantity')::numeric, 1)), 2)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.services) = 'array' THEN a.services ELSE '[]'::jsonb END) AS item
              ), 0)
            )
            FROM appointments a
            WHERE a.salon_id = $1
              AND DATE(a.scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
              AND a.status NOT IN ('completed', 'cancelled', 'no_show', 'in_progress')
          ), 0)::numeric AS pending_amount`,
        [salonId, date ?? null]
      ),
    ]);

    const r = revenueRows.rows[0];
    const a = apptRows.rows[0];
    const ext = extendedRows.rows[0];

    const totalRevenue = parseFloat(r.total_revenue);
    const lastMonthRevenue = parseFloat(r.last_month_revenue);
    const todayRevenue = parseFloat(r.today_revenue);
    const lastMonthTodayRevenue = parseFloat(r.last_month_today_revenue);
    const todayProductRevenue = parseFloat(r.today_product_revenue);
    const lastMonthTodayProductRevenue = parseFloat(r.last_month_today_product_revenue);

    const totalAppointments = parseInt(a.total_appointments, 10);
    const lastMonthAppointments = parseInt(a.last_month_appointments, 10);
    const totalClients = parseInt(clientRows.rows[0].total_clients, 10);
    const todayAppointmentsCount = parseInt(a.today_appointments, 10);

    // Percentage changes (null when last-month baseline is 0)
    const pctChange = (curr: number, prev: number): number | null => {
      if (prev === 0) return curr > 0 ? 100 : null;
      return round1(((curr - prev) / prev) * 100);
    };

    return {
      totalRevenue,
      totalAppointments,
      totalClients,
      todayRevenue,
      revenueChange: pctChange(totalRevenue, lastMonthRevenue),
      appointmentsChange: pctChange(totalAppointments, lastMonthAppointments),
      clientsChange: null, // no last-month baseline available here
      todayRevenueChange: pctChange(todayRevenue, lastMonthTodayRevenue),
      todayAppointmentsCount,
      todayClientCount: parseInt(ext.today_clients, 10),
      yesterdayRevenue: parseFloat(ext.yesterday_revenue),
      yesterdayAppointmentsCount: parseInt(ext.yesterday_appointments, 10),
      yesterdayClientCount: parseInt(ext.yesterday_clients, 10),
      pendingClients: parseInt(ext.pending_clients, 10),
      pendingAmount: parseFloat(ext.pending_amount),
      todayProductRevenue,
      todayProductRevenueChange: pctChange(todayProductRevenue, lastMonthTodayProductRevenue),
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
    }>(
      `SELECT
         a.id,
         COALESCE(
           c.full_name,
           TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
         ) AS client_name,
         COALESCE(a.title, 'Service') AS service,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS staff_name,
         TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time,
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
         )::numeric AS amount
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN staff  s ON s.id = a.staff_id
       WHERE a.salon_id = $1
         AND DATE(a.scheduled_at AT TIME ZONE 'Asia/Kolkata') = COALESCE($2::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
       ORDER BY a.scheduled_at ASC`,
      [salonId, date ?? null]
    );

    return rows.map((row) => ({
      id: row.id,
      clientName: row.client_name || "Walk-in",
      service: row.service,
      staffName: row.staff_name || "—",
      time: row.time,
      status: mapStatus(row.status),
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
      `SELECT
         s.id,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS name,
         COALESCE(s.designation, 'Staff') AS role,
         UPPER(
           LEFT(COALESCE(s.first_name, '?'), 1) ||
           LEFT(COALESCE(s.last_name,  '?'), 1)
         ) AS avatar,
         COUNT(DISTINCT a.client_id)              AS client_count,
         COALESCE(SUM(sl.total_amount), 0)::numeric AS revenue,
         COUNT(DISTINCT a.id)                     AS bookings
       FROM staff s
       LEFT JOIN appointments a
              ON a.staff_id = s.id
             AND date_trunc('month', a.scheduled_at) = date_trunc('month', NOW())
             AND a.status = 'completed'
       LEFT JOIN sales sl
              ON sl.staff_id = s.id
             AND date_trunc('month', sl.created_at) = date_trunc('month', NOW())
             AND sl.status = 'completed'
       WHERE s.salon_id = $1
         AND s.is_active = true
       GROUP BY s.id, s.first_name, s.last_name, s.designation
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

  // ── Combined: all dashboard data in one call ────────────────────────────────
  async getAll(salonId: string, period: string = "monthly", date?: string): Promise<DashboardAll> {
    const [summary, todayAppointments, revenueChart, topStaff, serviceMix, services] =
      await Promise.all([
        this.getSummary(salonId, date),
        this.getTodayAppointments(salonId, date),
        this.getRevenueChart(salonId, period),
        this.getTopStaff(salonId),
        this.getServiceMix(salonId),
        this.getServices(salonId),
      ]);

    return { summary, todayAppointments, revenueChart, topStaff, serviceMix, services };
  },
};
