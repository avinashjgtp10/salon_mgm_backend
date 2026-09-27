import pool from "../../config/database";
import logger from "../../config/logger";
import { reportsRepository } from "../reports/reports.repository";
import { appointmentsService } from "../appointments/appointments.service";
import type {
  DashboardSummary,
  RevenueDataPoint,
  PaymentModeBreakdown,
  TopStaffMember,
  StaffRevenueEntry,
  ServiceMixItem,
  DashboardCombined,
  PendingPayments,
  TodaysBirthdays,
} from "./salon-dashboard.types";

// Round a number to 1 decimal place
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const salonDashboardRepository = {
  // ── KPI Summary ─────────────────────────────────────────────────────────────
  async getSummary(salonId: string): Promise<DashboardSummary> {
    // IST calendar-month bounds for last month, as start_date/end_date —
    // same shape the Sales Summary report's own date picker sends, so this
    // reads the identical range _buildSalesSummaryWhere applies there.
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const lastMonthDate = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - 1, 1));
    const lastMonthYear = lastMonthDate.getUTCFullYear();
    const lastMonthMonth = lastMonthDate.getUTCMonth();
    const lastMonthStart = `${lastMonthYear}-${String(lastMonthMonth + 1).padStart(2, "0")}-01`;
    const lastMonthEndDay = new Date(Date.UTC(lastMonthYear, lastMonthMonth + 1, 0)).getUTCDate();
    const lastMonthEnd = `${lastMonthYear}-${String(lastMonthMonth + 1).padStart(2, "0")}-${String(lastMonthEndDay).padStart(2, "0")}`;

    const [revenueRows, apptRows, newClientRows, salesSummaryStats, lastMonthSalesSummaryStats] = await Promise.all([
      // Revenue: this month, last month, today, yesterday.
      pool.query<{
        total_revenue: string;
        today_revenue: string;
        last_month_today_revenue: string;
        yesterday_revenue: string;
      }>(
        `WITH sales_rows AS (
           -- Completed sales whose appointment (if any) hasn't since been
           -- cancelled/no-showed/soft-deleted. 'partial' is included in the
           -- appointment-status gate — a sale only gets created once a single
           -- payment leg fully clears (payments.service.ts), but the
           -- appointment's own status can still read 'partial' after that
           -- (e.g. a top-up that settles the balance without flipping the
           -- appointment back to 'paid').
           -- Revenue here means money actually RECEIVED, not the bill's
           -- Grand Total — same convention as Sales Summary's
           -- received_amount (reports.repository.ts's sales_side.paid_amount,
           -- also what getSalesSummaryReportStats/all_time_revenue above now
           -- delegates to directly): for an appointment-linked sale, sum
           -- whatever payments were actually collected against it (a
           -- quantity/price edit after the fact can leave sales.total_amount
           -- stale, or a bill can still be partially paid), falling back to
           -- the sale's own total_amount only for a walk-in/no-appointment
           -- sale that has no payments row to read from.
           --
           -- Dated by the appointment's scheduled visit, falling back to
           -- s.created_at only for a walk-in sale with no linked appointment
           -- — same convention reports.repository.ts's _buildSalesSummaryWhere
           -- uses for its own date filter, and for the exact same reason:
           -- checkout can lag the visit by a day or more (a bill for
           -- yesterday's appointment closed out today), so s.created_at alone
           -- silently misdated it — a bill that Sales Summary's "Yesterday"
           -- filter correctly counted as yesterday's revenue, this Dashboard
           -- card was showing under today's instead.
           SELECT COALESCE(a.scheduled_at, s.created_at) AS event_at,
             CASE
               WHEN s.appointment_id IS NOT NULL THEN COALESCE(pay.paid_from_payments, 0)
               ELSE ROUND(s.total_amount)
             END AS amount
           FROM sales s
           LEFT JOIN appointments a ON a.id = s.appointment_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS paid_from_payments
             FROM payments p
             WHERE p.appointment_id = s.appointment_id
           ) pay ON s.appointment_id IS NOT NULL
           WHERE s.salon_id = $1
             AND s.status = 'completed'
             AND COALESCE(a.scheduled_at, s.created_at) >= date_trunc('month', NOW() - INTERVAL '1 month')
             AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
         ),
         -- Money genuinely collected on a bill still short of the full total
         -- (a real deposit, not yet settled) — no sales row exists for these
         -- yet, so without this branch that money is invisible to revenue
         -- until (if ever) the remainder gets paid. Dated by the appointment's
         -- scheduled visit, same as sales_rows above, not by when the deposit
         -- happened to be collected.
         open_partial_rows AS (
           SELECT COALESCE(a.scheduled_at, p.created_at) AS event_at, p.paid_amount AS amount
           FROM payments p
           JOIN appointments a ON a.id = p.appointment_id
           WHERE p.salon_id = $1
             AND p.status = 'partial'
             AND COALESCE(a.scheduled_at, p.created_at) >= date_trunc('month', NOW() - INTERVAL '1 month')
             AND a.deleted_at IS NULL
             AND a.status NOT IN ('cancelled', 'no-show')
             AND NOT EXISTS (
               SELECT 1 FROM sales s2
               WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
             )
         ),
         revenue_events AS (
           SELECT event_at, amount FROM sales_rows
           UNION ALL
           SELECT event_at, amount FROM open_partial_rows
         ),
         -- The DB session runs in UTC (see database.ts), but the salon's
         -- business day is Asia/Kolkata (IST, UTC+5:30) — bare CURRENT_DATE/
         -- DATE(event_at) rolled over at UTC midnight, i.e. 5:30am IST, so a
         -- bill completed in the first ~5.5 hours of an IST day (e.g. a late
         -- checkout just after midnight) landed a full calendar day earlier
         -- than its true business date, dropping it out of both "today" and
         -- "yesterday" and into the day before. Same fix as
         -- cash-management.repository.ts's openCounter once-per-day check.
         bounds AS (
           SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS ist_today
         )
         SELECT
           COALESCE(SUM(CASE WHEN date_trunc('month', event_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', bounds.ist_today)
             THEN amount ELSE 0 END), 0)::numeric AS total_revenue,
           COALESCE(SUM(CASE WHEN (event_at AT TIME ZONE 'Asia/Kolkata')::date = bounds.ist_today
             THEN amount ELSE 0 END), 0)::numeric AS today_revenue,
           COALESCE(SUM(CASE WHEN (event_at AT TIME ZONE 'Asia/Kolkata')::date = (bounds.ist_today - INTERVAL '1 month')::date
             THEN amount ELSE 0 END), 0)::numeric AS last_month_today_revenue,
           COALESCE(SUM(CASE WHEN (event_at AT TIME ZONE 'Asia/Kolkata')::date = bounds.ist_today - INTERVAL '1 day'
             THEN amount ELSE 0 END), 0)::numeric AS yesterday_revenue
         FROM revenue_events, bounds`,
        [salonId]
      ),

      // Appointments: today, yesterday
      pool.query<{
        today_appointments: string;
        yesterday_appointments: string;
      }>(
        `SELECT
           COUNT(CASE WHEN DATE(scheduled_at) = CURRENT_DATE
             THEN 1 END) AS today_appointments,
           COUNT(CASE WHEN DATE(scheduled_at) = CURRENT_DATE - INTERVAL '1 day'
             THEN 1 END) AS yesterday_appointments
         FROM appointments
         WHERE salon_id = $1
           AND deleted_at IS NULL
           AND status NOT IN ('cancelled', 'no-show')
           AND scheduled_at >= CURRENT_DATE - INTERVAL '1 day'`,
        [salonId]
      ),

      // New clients — earliest of: their client profile being created (e.g. via
      // Clients → Add Client, with no booking/sale at all yet), or their
      // first-ever appointment/sale at this salon (Calendar/Quick Sale, which
      // create the client record and the appointment together). Including the
      // clients row itself means a client added ONLY via Add Client (no
      // appointment/sale ever) still counts as "new" the day they were added,
      // instead of never appearing here at all.
      pool.query<{ new_today: string; new_this_month: string }>(
        `WITH first_visit AS (
           SELECT client_id, MIN(created_at) AS first_at
           FROM (
             SELECT client_id, created_at FROM appointments WHERE salon_id = $1 AND client_id IS NOT NULL AND deleted_at IS NULL
             UNION ALL
             SELECT client_id, created_at FROM sales       WHERE salon_id = $1 AND client_id IS NOT NULL
             UNION ALL
             SELECT id AS client_id, created_at FROM clients WHERE salon_id = $1
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
      // above which is scoped to the current calendar month. Not read by the
      // salon dashboard page itself, but branch-owner.service.ts's
      // multi-branch Finance Overview reads it off this same getSummary()
      // call. Delegates to the exact same function the Sales Summary report
      // calls for its own "Received Amount" stat, so this figure is
      // guaranteed to match rather than a separately-maintained approximation
      // that can drift out of sync.
      reportsRepository.getSalesSummaryReportStats(salonId, { payment_statuses: ["paid", "partial"] }),

      // Last month's revenue — same delegation as allTimeRevenue above, just
      // scoped to last month's IST date range, so this matches exactly what
      // the Sales Summary report shows when filtered to that same range
      // instead of drifting from a separately hand-rolled query.
      reportsRepository.getSalesSummaryReportStats(salonId, {
        payment_statuses: ["paid", "partial"],
        start_date: lastMonthStart,
        end_date: lastMonthEnd,
      }),
    ]);

    const r = revenueRows.rows[0];
    const a = apptRows.rows[0];
    const nc = newClientRows.rows[0];

    const totalRevenue = parseFloat(r.total_revenue);
    const allTimeRevenue = Number(salesSummaryStats.received_amount) || 0;
    const lastMonthRevenue = Number(lastMonthSalesSummaryStats.received_amount) || 0;
    const todayRevenue = parseFloat(r.today_revenue);
    const lastMonthTodayRevenue = parseFloat(r.last_month_today_revenue);
    const yesterdayRevenue = parseFloat(r.yesterday_revenue);

    const todayAppointmentsCount = parseInt(a.today_appointments, 10);
    const yesterdayAppointmentsCount = parseInt(a.yesterday_appointments, 10);

    const newClientsToday = parseInt(nc?.new_today ?? "0", 10);
    const newClientsThisMonth = parseInt(nc?.new_this_month ?? "0", 10);

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
      todayRevenue,
      revenueChange: pctChange(totalRevenue, lastMonthRevenue),
      todayRevenueChange: pctChange(todayRevenue, lastMonthTodayRevenue),
      todayAppointmentsCount,
      yesterdayAppointmentsCount,
    };
  },

  // ── Revenue Chart (today / weekly / monthly / yearly) ───────────────────────
  async getRevenueChart(salonId: string, period: string = "monthly", gender?: string): Promise<RevenueDataPoint[]> {
    // Gender is resolved via COALESCE(s.client_id, a.client_id)/a.client_id —
    // a sale's own client_id when it has one (walk-in sales always do),
    // falling back to its linked appointment's client for an appointment-
    // billed sale. 'all'/empty means "no filter" (every event counted),
    // same convention as the Client Revenue report's own gender filter.
    const genderClause = gender && gender !== "all" ? `AND LOWER(cl.gender) = $2` : "";
    const genderValues = gender && gender !== "all" ? [gender.toLowerCase()] : [];

    // Shared event source for every period below: completed sales (gated on
    // appointment status same as getSummary) UNION ALL still-open partial-
    // payment deposits with no sales row yet. 13-month floor keeps the scan
    // bounded while covering every period branch that reads from it.
    const eventsCte = `
      WITH sales_rows AS (
        -- Revenue here means money actually RECEIVED, not the bill's Grand
        -- Total — same convention as getSummary's sales_rows (Today's/Total
        -- Revenue stat cards) and Sales Summary's received_amount: for an
        -- appointment-linked sale, sum whatever payments were actually
        -- collected against it, falling back to the sale's own total_amount
        -- only for a walk-in/no-appointment sale with no payments row to
        -- read from. This chart used to sum s.total_amount unconditionally,
        -- so a bill left partially paid showed its full quoted price here
        -- instead of what was actually received — disagreeing with the
        -- stat cards right above it on the same dashboard.
        SELECT s.created_at AS event_at,
          CASE
            WHEN s.appointment_id IS NOT NULL THEN COALESCE(pay.paid_from_payments, 0)
            ELSE ROUND(s.total_amount)
          END AS amount
        FROM sales s
        LEFT JOIN appointments a ON a.id = s.appointment_id
        LEFT JOIN clients cl ON cl.id = COALESCE(s.client_id, a.client_id)
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS paid_from_payments
          FROM payments p
          WHERE p.appointment_id = s.appointment_id
        ) pay ON s.appointment_id IS NOT NULL
        WHERE s.salon_id = $1
          AND s.status = 'completed'
          AND s.created_at >= NOW() - INTERVAL '13 months'
          AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
          ${genderClause}
      ),
      open_partial_rows AS (
        SELECT p.created_at AS event_at, p.paid_amount AS amount
        FROM payments p
        JOIN appointments a ON a.id = p.appointment_id
        LEFT JOIN clients cl ON cl.id = a.client_id
        WHERE p.salon_id = $1
          AND p.status = 'partial'
          AND p.created_at >= NOW() - INTERVAL '13 months'
          AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'no-show')
          AND NOT EXISTS (
            SELECT 1 FROM sales s2
            WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
          )
          ${genderClause}
      ),
      revenue_events AS (
        SELECT event_at, amount FROM sales_rows
        UNION ALL
        SELECT event_at, amount FROM open_partial_rows
      )`;

    let sql: string;

    if (period === "today") {
      // Axis and tooltip are identical here — the hour itself IS the full
      // context ("09:00 AM"), so no separate full_label is needed.
      sql = `${eventsCte}
        SELECT
          TO_CHAR(date_trunc('hour', event_at AT TIME ZONE 'UTC'), 'HH12:MI AM') AS month,
          TO_CHAR(date_trunc('hour', event_at AT TIME ZONE 'UTC'), 'HH12:MI AM') AS full_label,
          date_trunc('hour', event_at AT TIME ZONE 'UTC')                        AS sort_key,
          COALESCE(SUM(amount), 0)::numeric                                      AS revenue
        FROM revenue_events
        WHERE DATE(event_at AT TIME ZONE 'UTC') = CURRENT_DATE
        GROUP BY date_trunc('hour', event_at AT TIME ZONE 'UTC')
        ORDER BY sort_key ASC`;
    } else if (period === "weekly") {
      // Axis: weekday only ("Tue") — the date used to also share the axis
      // label ("Tue 28"), leaving no room for a distinct full-context
      // tooltip; the full date now lives in full_label instead.
      sql = `${eventsCte}
        SELECT
          TO_CHAR(DATE(event_at AT TIME ZONE 'UTC'), 'Dy')            AS month,
          TO_CHAR(DATE(event_at AT TIME ZONE 'UTC'), 'Dy, DD Mon YYYY') AS full_label,
          DATE(event_at AT TIME ZONE 'UTC')                            AS sort_key,
          COALESCE(SUM(amount), 0)::numeric                            AS revenue
        FROM revenue_events
        WHERE event_at >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE(event_at AT TIME ZONE 'UTC')
        ORDER BY sort_key ASC`;
    } else if (period === "yearly") {
      // Axis: month only ("Jul") — the year used to sit right on the axis
      // label ("Jul 26"); moved to full_label ("Jul 2026", 4-digit year) so
      // the axis stays short across 12 ticks.
      sql = `${eventsCte}
        SELECT
          TO_CHAR(date_trunc('month', event_at), 'Mon')      AS month,
          TO_CHAR(date_trunc('month', event_at), 'Mon YYYY') AS full_label,
          date_trunc('month', event_at)                       AS sort_key,
          COALESCE(SUM(amount), 0)::numeric                   AS revenue
        FROM revenue_events
        WHERE event_at >= NOW() - INTERVAL '12 months'
        GROUP BY date_trunc('month', event_at)
        ORDER BY sort_key ASC`;
    } else {
      // monthly — daily data for the current calendar month, one tick per
      // day of the month (never grouped into Week 1/2/3/4). FM strips the
      // leading zero so the axis reads "1, 2, 3 … 28" not "01, 02, 03 … 28".
      sql = `${eventsCte}
        SELECT
          TO_CHAR(DATE(event_at AT TIME ZONE 'UTC'), 'FMDD')       AS month,
          TO_CHAR(DATE(event_at AT TIME ZONE 'UTC'), 'DD Mon YYYY') AS full_label,
          DATE(event_at AT TIME ZONE 'UTC')                         AS sort_key,
          COALESCE(SUM(amount), 0)::numeric                         AS revenue
        FROM revenue_events
        WHERE date_trunc('month', event_at AT TIME ZONE 'UTC') = date_trunc('month', NOW() AT TIME ZONE 'UTC')
        GROUP BY DATE(event_at AT TIME ZONE 'UTC')
        ORDER BY sort_key ASC`;
    }

    const { rows } = await pool.query<{ month: string; full_label: string; revenue: string }>(sql, [salonId, ...genderValues]);

    return rows.map((row) => ({
      month: row.month,
      fullLabel: row.full_label,
      revenue: parseFloat(row.revenue),
    }));
  },

  // ── Payment Mode Breakdown ("Overall Collection" card) ──────────────────
  // Powers the card that replaced the old appointment-status "Today's
  // Summary" bar chart. Deliberately reuses the Sales Summary report's own
  // filter/CTE building blocks (_buildSalesSummaryWhere,
  // _UNBILLED_APPOINTMENT_ROWS_CTE, _PAYMENT_LATERAL,
  // _APPOINTMENT_STATUS_JOIN) instead of a hand-rolled parallel definition —
  // an earlier version summed its own "amount received" and even split a
  // 'split' sale's JSON payment_reference across Cash/Card/UPI, so its
  // numbers could never match Sales Summary filtered to the same payment
  // mode: that report's own payment-mode filter is a plain
  // `s.payment_method = 'cash'` equality (never split-aware). Grouping by
  // the literal payment_method here, off the exact same query shape, is the
  // only way to guarantee the two screens always agree.
  async getPaymentModeBreakdown(salonId: string, period: string = "today"): Promise<PaymentModeBreakdown> {
    // IST calendar date, computed from the UTC epoch directly (not the
    // server process's local clock) — same "today" the date range picker and
    // every report on this app means.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istDateString = (offsetDays: number) =>
      new Date(Date.now() + IST_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);

    // IST calendar month-to-date start, for the "month" period below.
    const istMonthStartString = () => {
      const ist = new Date(Date.now() + IST_OFFSET_MS);
      return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-01`;
    };

    const dateFilters = period === "yesterday"
      ? { start_date: istDateString(-1), end_date: istDateString(-1) }
      : period === "week"
      // Last 7 days inclusive of today — same "week" convention as
      // getStaffRevenue's weekly bucket below.
      ? { start_date: istDateString(-6), end_date: istDateString(0) }
      : period === "month"
      ? { start_date: istMonthStartString(), end_date: istDateString(0) }
      : { start_date: istDateString(0), end_date: istDateString(0) };

    const { where, values, nextIndex } = reportsRepository._buildSalesSummaryWhere(salonId, dateFilters);
    const unbilled = reportsRepository._UNBILLED_APPOINTMENT_ROWS_CTE(dateFilters, nextIndex);

    const { rows } = await pool.query<{ payment_method: string | null; amount: string }>(
      `WITH sales_side AS (
         SELECT
           LOWER(s.payment_method) AS payment_method,
           CASE
             WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
             WHEN s.status = 'completed' THEN s.total_amount::numeric
             ELSE 0
           END AS paid_amount
         FROM sales s
         LEFT JOIN clients c ON s.client_id = c.id
         ${reportsRepository._PAYMENT_LATERAL}
         ${reportsRepository._APPOINTMENT_STATUS_JOIN}
         WHERE ${where}
       ),
       appt_side AS (
         SELECT LOWER(u.payment_method) AS payment_method, u.paid_amount
         FROM (${unbilled.sql}) u
       ),
       unified AS (
         SELECT payment_method, paid_amount FROM sales_side
         UNION ALL
         SELECT payment_method, paid_amount FROM appt_side
       )
       SELECT payment_method, COALESCE(SUM(paid_amount), 0) AS amount
       FROM unified
       -- 'split' isn't a real collection channel — it's cash/card/UPI in some
       -- combination the report's own payment-mode filter can't decompose
       -- (see the module comment above), so grouping it as its own bucket
       -- here previously implied a 4th channel actually collected that money
       -- verbatim, when none of it landed in an actual cash/card/UPI till.
       WHERE payment_method IS NOT NULL AND payment_method <> 'split'
       GROUP BY payment_method`,
      [...values, ...unbilled.values]
    );

    const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const entries = rows
      .map((r) => ({
        method: String(r.payment_method),
        amount: Number(r.amount) || 0,
        percentage: total > 0 ? Math.round((Number(r.amount) / total) * 1000) / 10 : 0,
      }))
      .filter((e) => e.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    return { entries, total };
  },

  // ── Staff Revenue (donut) — same period semantics as getRevenueChart ───────
  async getStaffRevenue(salonId: string, period: string = "monthly"): Promise<StaffRevenueEntry[]> {
    let dateCond: string;
    if (period === "today") {
      dateCond = `DATE(re.event_at AT TIME ZONE 'UTC') = CURRENT_DATE`;
    } else if (period === "weekly") {
      dateCond = `re.event_at >= CURRENT_DATE - INTERVAL '6 days'`;
    } else if (period === "yearly") {
      dateCond = `re.event_at >= NOW() - INTERVAL '12 months'`;
    } else {
      dateCond = `date_trunc('month', re.event_at AT TIME ZONE 'UTC') = date_trunc('month', NOW() AT TIME ZONE 'UTC')`;
    }

    const { rows } = await pool.query<{ id: string; name: string; role: string; revenue: string }>(
      `WITH sales_rows AS (
         -- Received amount, not the bill's Grand Total — same convention as
         -- getSummary/getRevenueChart's sales_rows (see getRevenueChart's
         -- comment for why).
         SELECT sl.staff_id, sl.created_at AS event_at,
           CASE
             WHEN sl.appointment_id IS NOT NULL THEN COALESCE(pay.paid_from_payments, 0)
             ELSE ROUND(sl.total_amount)
           END AS amount
         FROM sales sl
         LEFT JOIN appointments a ON a.id = sl.appointment_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS paid_from_payments
           FROM payments p
           WHERE p.appointment_id = sl.appointment_id
         ) pay ON sl.appointment_id IS NOT NULL
         WHERE sl.salon_id = $1
           AND sl.status = 'completed'
           AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
       ),
       open_partial_rows AS (
         -- payments has no staff_id of its own — attributed to the
         -- appointment's assigned staff, the same source the eventual sales
         -- row's own staff_id would come from (payments.service.ts).
         SELECT a.staff_id, p.created_at AS event_at, p.paid_amount AS amount
         FROM payments p
         JOIN appointments a ON a.id = p.appointment_id
         WHERE p.salon_id = $1
           AND p.status = 'partial'
           AND a.deleted_at IS NULL
           AND a.status NOT IN ('cancelled', 'no-show')
           AND NOT EXISTS (
             SELECT 1 FROM sales s2
             WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
           )
       ),
       revenue_events AS (
         SELECT staff_id, event_at, amount FROM sales_rows
         UNION ALL
         SELECT staff_id, event_at, amount FROM open_partial_rows
       )
       SELECT
         s.id,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS name,
         COALESCE(s.designation, 'Staff') AS role,
         COALESCE(SUM(re.amount), 0)::numeric AS revenue
       FROM staff s
       LEFT JOIN revenue_events re
              ON re.staff_id = s.id
             AND ${dateCond}
       WHERE s.salon_id = $1
         AND s.is_active = true
       GROUP BY s.id, s.first_name, s.last_name, s.designation
       HAVING COALESCE(SUM(re.amount), 0) > 0
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
           AND status = 'paid'
         GROUP BY staff_id
       ),
       sales_rows AS (
         -- Received amount, not the bill's Grand Total — same convention as
         -- getSummary/getRevenueChart's sales_rows (see getRevenueChart's
         -- comment for why).
         SELECT sl.staff_id,
           CASE
             WHEN sl.appointment_id IS NOT NULL THEN COALESCE(pay.paid_from_payments, 0)
             ELSE ROUND(sl.total_amount)
           END AS amount
         FROM sales sl
         LEFT JOIN appointments a ON a.id = sl.appointment_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS paid_from_payments
           FROM payments p
           WHERE p.appointment_id = sl.appointment_id
         ) pay ON sl.appointment_id IS NOT NULL
         WHERE sl.salon_id = $1
           AND date_trunc('month', sl.created_at) = date_trunc('month', NOW())
           AND sl.status = 'completed'
           AND (a.id IS NULL OR (a.status IN ('paid', 'partial') AND a.deleted_at IS NULL))
       ),
       open_partial_rows AS (
         -- Same still-open-deposit reasoning as getStaffRevenue/getRevenueChart
         -- above — attributed to the appointment's assigned staff since
         -- payments has no staff_id of its own.
         SELECT a.staff_id, p.paid_amount AS amount
         FROM payments p
         JOIN appointments a ON a.id = p.appointment_id
         WHERE p.salon_id = $1
           AND date_trunc('month', p.created_at) = date_trunc('month', NOW())
           AND p.status = 'partial'
           AND a.deleted_at IS NULL
           AND a.status NOT IN ('cancelled', 'no-show')
           AND NOT EXISTS (
             SELECT 1 FROM sales s2
             WHERE s2.appointment_id = p.appointment_id AND s2.status = 'completed'
           )
       ),
       sales_stats AS (
         SELECT staff_id, COALESCE(SUM(amount), 0)::numeric AS revenue
         FROM (
           SELECT staff_id, amount FROM sales_rows
           UNION ALL
           SELECT staff_id, amount FROM open_partial_rows
         ) combined
         GROUP BY staff_id
       )
       SELECT
         s.id,
         TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS name,
         COALESCE(s.designation, 'Staff') AS role,
         -- Initials only — first+last when both exist, else just the one
         -- available name's first letter (never a literal "?" filler for a
         -- missing last name, which is what NULLIF(...,'') || COALESCE
         -- guards against below).
         UPPER(
           LEFT(COALESCE(s.first_name, ''), 1) ||
           LEFT(COALESCE(NULLIF(s.last_name, ''), ''), 1)
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
         AND a.status = 'paid'
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
         -- Excludes refunded rows so a refunded payment can never surface as
         -- "latest" and contribute a stale due_amount — same rule the Pending
         -- Payment/Payment Collection reports apply, so the two figures can't
         -- structurally disagree over which payment row is authoritative.
         SELECT p.due_amount FROM payments p
         WHERE p.appointment_id = a.id
           AND p.status <> 'refunded'
         -- Same tie-break as the Pending Payment/Payment Collection reports:
         -- when two payment rows share the same created_at timestamp (a
         -- completing payment written in the same second as the partial it
         -- settles), prefer the 'completed' row. Without this, plain
         -- "ORDER BY created_at DESC" leaves Postgres to pick arbitrarily
         -- between the tied rows, and picking the stale 'partial' row reports
         -- a bill the client already paid off in full as still pending —
         -- inflating this card's client count/amount above what the reports
         -- (which always break the tie deterministically) show.
         ORDER BY p.created_at DESC, (p.status = 'completed') DESC, p.due_amount ASC
         LIMIT 1
       ) latest
       WHERE a.salon_id = $1
         AND a.deleted_at IS NULL
         AND a.client_id IS NOT NULL
         -- Same exclusion as the reports: a cancelled/no-show/deleted
         -- appointment's stale payment row must not count as outstanding.
         AND a.status::text NOT IN ('cancelled', 'deleted', 'no-show')
         AND latest.due_amount > 0`,
      [salonId]
    );
    return { count: parseInt(rows[0]?.cnt ?? "0", 10), amount: parseFloat(rows[0]?.amount ?? "0") };
  },

  // ── Today's Birthdays ────────────────────────────────────────────────────────
  // birthday_day_month is stored as "MM-DD" (see clients.types.ts).
  async getTodaysBirthdays(salonId: string): Promise<TodaysBirthdays> {
    const { rows } = await pool.query<{ id: string; name: string; phone_number: string | null; phone_country_code: string | null }>(
      `SELECT c.id, COALESCE(c.full_name, TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''))) AS name,
              c.phone_number, c.phone_country_code
       FROM clients c
       WHERE c.salon_id = $1
         AND c.is_active = true
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
    return {
      clients: rows.map((r) => ({
        id: r.id, name: r.name || "Unknown",
        phone: r.phone_number, phoneCountryCode: r.phone_country_code,
      })),
    };
  },

  // ── Combined: everything the dashboard page needs in one call ──────────────
  // Each sub-query is isolated — a DB timeout or slow/broken query on one
  // section falls back to a safe empty/zero default instead of crashing the
  // entire response, but the failure itself is logged so a section silently
  // going to its fallback is visible in the logs instead of looking like a
  // legitimate "nothing here" result.
  async getCombined(
    salonId: string,
    period: string = "monthly",
    date?: string,
    collectionPeriod: string = "today",
  ): Promise<DashboardCombined> {
    const safe = <T>(p: Promise<T>, fallback: T, label: string): Promise<T> =>
      p.catch((err) => {
        logger.error(`[dashboard.getCombined] ${label} failed, using fallback`, { salonId, error: err?.message ?? err });
        return fallback;
      });

    const defaultSummary: DashboardSummary = {
      totalRevenue: 0, allTimeRevenue: 0, todayRevenue: 0, revenueChange: null,
      todayRevenueChange: null, todayAppointmentsCount: 0, yesterdayAppointmentsCount: 0,
      lastMonthRevenue: 0, yesterdayRevenue: 0, newClientsToday: 0, newClientsThisMonth: 0,
    };
    const defaultPending: PendingPayments = { count: 0, amount: 0 };
    const defaultBirthdays: TodaysBirthdays = { clients: [] };
    const defaultBreakdown: PaymentModeBreakdown = { entries: [], total: 0 };

    // Today's appointments come from the same enriched listing
    // GET /api/v1/appointments uses (tax-aware grand total, live edits) —
    // not a separately hand-rolled snapshot query — so this can never drift
    // from what the Calendar/Appointments screen shows for the same day.
    const todayAppointmentsPromise = appointmentsService
      .list({ salonId, date: date ?? new Date().toISOString().slice(0, 10), limit: 200 })
      .then((result) => (Array.isArray(result) ? result : result.data));

    const [summary, todayAppointments, revenueChart, pendingPayments, todaysBirthdays, paymentModeBreakdown] = await Promise.all([
      safe(this.getSummary(salonId),                        defaultSummary,   "getSummary"),
      safe(todayAppointmentsPromise,                         [],               "getTodayAppointments"),
      safe(this.getRevenueChart(salonId, period),            [],               "getRevenueChart"),
      safe(this.getPendingPayments(salonId),                 defaultPending,   "getPendingPayments"),
      safe(this.getTodaysBirthdays(salonId),                 defaultBirthdays, "getTodaysBirthdays"),
      safe(this.getPaymentModeBreakdown(salonId, collectionPeriod), defaultBreakdown, "getPaymentModeBreakdown"),
    ]);

    return { summary, todayAppointments, revenueChart, pendingPayments, todaysBirthdays, paymentModeBreakdown };
  },
};
