import pool from "../../config/database";
import { botQuestionsRepository } from "../bot/bot-questions.repository";

// Everything the Super Admin Overview page shows, in ONE response (GET /super-admin/overview?from=&to=).
// Dates are IST calendar days (YYYY-MM-DD, inclusive) like the rest of the Super Admin figures. "Salons" here are
// real salons only (is_dummy = false) so demo data never inflates the numbers. Optional sections (issues, tickets,
// announcements, chatbot) are guarded individually: a table that isn't migrated yet leaves its section empty
// instead of failing the whole dashboard.

const IST_DAY = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;

// A subscription that is currently live (same rule getStats / users-no-plan use).
const LIVE_SUB = `(
  (sub.status = 'active'   AND (sub.current_period_end IS NULL OR sub.current_period_end > NOW()))
  OR (sub.status = 'trialing' AND (sub.trial_end IS NULL OR sub.trial_end > NOW()))
)`;

const REAL_SALON = `COALESCE(s.is_dummy, false) = false`;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000) + 1;

const pct = (cur: number, prev: number): number | null => {
  if (!cur && !prev) return null;
  if (!prev) return 100;
  return Math.round(((cur - prev) / prev) * 100);
};

async function guarded<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function rows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

// One value per day in [from, to]; days with nothing are 0 so the sparkline has no gaps.
const daily = (from: string, to: string, join: string, expr = "COUNT(x.id)") =>
  rows<{ day: string; v: string }>(
    `SELECT d::date::text AS day, ${expr}::numeric AS v
       FROM generate_series($1::date, $2::date, '1 day') d
       LEFT JOIN LATERAL (${join}) x ON true
      GROUP BY d ORDER BY d`,
    [from, to]
  ).then((r) => r.map((x) => Number(x.v) || 0));

export async function getSuperAdminOverview(fromIn?: string, toIn?: string, activeDaysIn?: number) {
  const activeDays = activeDaysIn === 30 ? 30 : 7;
  const today = iso(new Date(Date.now() + 5.5 * 3_600_000)); // IST "today"
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  let to = valid(toIn) ?? today;
  let from = valid(fromIn) ?? `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  // Cap the window so a stray "all time" can't ask for decades of daily points.
  if (daysBetween(from, to) > 400) from = addDays(to, -399);
  const span = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(span - 1));

  const [
    salonTotals,
    subTotals,
    revenueTotals,
    issueTotals,
    ticketTotals,
    salonSeries,
    subSeries,
    revenueSeries,
    issueSeries,
    ticketSeries,
    attention,
    monthly,
    plans,
    activity,
    issueByDev,
    activeSalons,
    botStats,
  ] = await Promise.all([
    // ── KPI figures ─────────────────────────────────────────────────────────────
    guarded(async () => {
      const [r] = await rows(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${IST_DAY("s.created_at")} BETWEEN $1::date AND $2::date)::int AS cur,
                COUNT(*) FILTER (WHERE ${IST_DAY("s.created_at")} BETWEEN $3::date AND $4::date)::int AS prev
           FROM salons s WHERE ${REAL_SALON}`,
        [from, to, prevFrom, prevTo]
      );
      return r;
    }, { total: 0, cur: 0, prev: 0 } as any),
    guarded(async () => {
      const [r] = await rows(
        `SELECT
           (SELECT COUNT(DISTINCT sub.salon_id)::int FROM subscriptions sub JOIN salons s ON s.id = sub.salon_id
             WHERE ${REAL_SALON} AND ${LIVE_SUB}) AS active,
           (SELECT COUNT(DISTINCT sub.salon_id)::int FROM subscriptions sub JOIN salons s ON s.id = sub.salon_id
             WHERE ${REAL_SALON} AND ${LIVE_SUB}
               AND (CASE WHEN sub.status = 'trialing' THEN sub.trial_end ELSE sub.current_period_end END)
                   BETWEEN NOW() AND NOW() + INTERVAL '7 days') AS expiring,
           (SELECT COUNT(DISTINCT sub.salon_id)::int FROM subscriptions sub JOIN salons s ON s.id = sub.salon_id
             WHERE ${REAL_SALON} AND sub.status NOT IN ('created','authenticated')
               AND ${IST_DAY("sub.created_at")} BETWEEN $1::date AND $2::date) AS cur,
           (SELECT COUNT(DISTINCT sub.salon_id)::int FROM subscriptions sub JOIN salons s ON s.id = sub.salon_id
             WHERE ${REAL_SALON} AND sub.status NOT IN ('created','authenticated')
               AND ${IST_DAY("sub.created_at")} BETWEEN $3::date AND $4::date) AS prev`,
        [from, to, prevFrom, prevTo]
      );
      return r;
    }, { active: 0, expiring: 0, cur: 0, prev: 0 } as any),
    guarded(async () => {
      const [r] = await rows(
        `SELECT
           COALESCE(SUM(p.net_amount) FILTER (WHERE ${IST_DAY("p.created_at")} BETWEEN $1::date AND $2::date), 0)::numeric AS cur,
           COALESCE(SUM(p.net_amount) FILTER (WHERE ${IST_DAY("p.created_at")} BETWEEN $3::date AND $4::date), 0)::numeric AS prev,
           COUNT(*) FILTER (WHERE p.status = 'failed' AND ${IST_DAY("p.created_at")} BETWEEN $1::date AND $2::date)::int AS failed
         FROM payments p JOIN salons s ON s.id = p.salon_id
        WHERE ${REAL_SALON} AND p.status IN ('completed','partial','failed')
          AND ${IST_DAY("p.created_at")} BETWEEN LEAST($1::date, $3::date) AND GREATEST($2::date, $4::date)`,
        [from, to, prevFrom, prevTo]
      );
      // The sums above must count completed/partial only; failed rows are only there for the failed count.
      const [ok] = await rows(
        `SELECT
           COALESCE(SUM(p.net_amount) FILTER (WHERE ${IST_DAY("p.created_at")} BETWEEN $1::date AND $2::date), 0)::numeric AS cur,
           COALESCE(SUM(p.net_amount) FILTER (WHERE ${IST_DAY("p.created_at")} BETWEEN $3::date AND $4::date), 0)::numeric AS prev
         FROM payments p JOIN salons s ON s.id = p.salon_id
        WHERE ${REAL_SALON} AND p.status IN ('completed','partial')`,
        [from, to, prevFrom, prevTo]
      );
      return { cur: Number(ok.cur), prev: Number(ok.prev), failed: r.failed };
    }, { cur: 0, prev: 0, failed: 0 }),
    guarded(async () => {
      const [r] = await rows(
        `SELECT
           COUNT(*) FILTER (WHERE r.status <> 'completed')::int AS open,
           COUNT(*) FILTER (WHERE r.status <> 'completed' AND r.priority = 'high')::int AS high,
           COUNT(*) FILTER (WHERE r.status = 'open')::int AS s_open,
           COUNT(*) FILTER (WHERE r.status = 'in_progress')::int AS s_progress,
           COUNT(*) FILTER (WHERE r.status = 'completed')::int AS s_done,
           COUNT(*) FILTER (WHERE ${IST_DAY("r.created_at")} BETWEEN $1::date AND $2::date)::int AS cur,
           COUNT(*) FILTER (WHERE ${IST_DAY("r.created_at")} BETWEEN $3::date AND $4::date)::int AS prev,
           COUNT(*) FILTER (WHERE r.status <> 'completed' AND r.assigned_to IS NULL AND NOT EXISTS (
             SELECT 1 FROM client_requirement_assignees a WHERE a.requirement_id = r.id))::int AS unassigned
         FROM client_requirements r`,
        [from, to, prevFrom, prevTo]
      );
      return r;
    }, { open: 0, high: 0, s_open: 0, s_progress: 0, s_done: 0, cur: 0, prev: 0, unassigned: 0 } as any),
    guarded(async () => {
      const [r] = await rows(
        `SELECT
           COUNT(*) FILTER (WHERE t.status = 'open')::int AS open,
           COUNT(*) FILTER (WHERE t.status IN ('open','in_progress') AND t.priority = 'high')::int AS high,
           COUNT(*) FILTER (WHERE ${IST_DAY("t.created_at")} BETWEEN $1::date AND $2::date)::int AS cur,
           COUNT(*) FILTER (WHERE ${IST_DAY("t.created_at")} BETWEEN $3::date AND $4::date)::int AS prev
         FROM support_tickets t`,
        [from, to, prevFrom, prevTo]
      );
      return r;
    }, { open: 0, high: 0, cur: 0, prev: 0 } as any),

    // ── Sparklines (one point per day of the selected range) ───────────────────
    guarded(() => daily(from, to, `SELECT s.id FROM salons s WHERE ${REAL_SALON} AND ${IST_DAY("s.created_at")} = d::date`), [] as number[]),
    guarded(() => daily(from, to, `SELECT sub.id FROM subscriptions sub JOIN salons s ON s.id = sub.salon_id WHERE ${REAL_SALON} AND sub.status NOT IN ('created','authenticated') AND ${IST_DAY("sub.created_at")} = d::date`), [] as number[]),
    guarded(() => daily(from, to, `SELECT p.net_amount AS amt, p.id FROM payments p JOIN salons s ON s.id = p.salon_id WHERE ${REAL_SALON} AND p.status IN ('completed','partial') AND ${IST_DAY("p.created_at")} = d::date`, "COALESCE(SUM(x.amt), 0)"), [] as number[]),
    guarded(() => daily(from, to, `SELECT r.id FROM client_requirements r WHERE ${IST_DAY("r.created_at")} = d::date`), [] as number[]),
    guarded(() => daily(from, to, `SELECT t.id FROM support_tickets t WHERE ${IST_DAY("t.created_at")} = d::date`), [] as number[]),

    // ── Needs attention (counts that don't depend on the date range) ────────────
    guarded(async () => {
      const [r] = await rows(
        `SELECT COUNT(*)::int AS no_plan
           FROM salons s
          WHERE ${REAL_SALON} AND s.is_active = true
            AND NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.salon_id = s.id AND ${LIVE_SUB})`
      );
      return r;
    }, { no_plan: 0 } as any),

    // ── Charts: last 12 months, bucketed by IST month ───────────────────────────
    guarded(
      () =>
        rows(
          `SELECT to_char(m, 'Mon') AS label, to_char(m, 'YYYY-MM') AS month,
                  (SELECT COUNT(*)::int FROM salons s
                    WHERE ${REAL_SALON} AND date_trunc('month', s.created_at AT TIME ZONE 'Asia/Kolkata') = m) AS salons,
                  (SELECT COALESCE(SUM(p.net_amount), 0)::numeric FROM payments p JOIN salons s ON s.id = p.salon_id
                    WHERE ${REAL_SALON} AND p.status IN ('completed','partial')
                      AND date_trunc('month', p.created_at AT TIME ZONE 'Asia/Kolkata') = m) AS revenue
             FROM generate_series(
                    date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '11 months',
                    date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata'), '1 month') m
            ORDER BY m`
        ),
      [] as any[]
    ),
    guarded(
      () =>
        rows(
          `SELECT COALESCE(sp.name, 'Other') AS name, COUNT(*)::int AS count
             FROM (
               SELECT DISTINCT ON (sub.salon_id) sub.salon_id, sub.plan_id
                 FROM subscriptions sub JOIN salons s ON s.id = sub.salon_id
                WHERE ${REAL_SALON} AND ${LIVE_SUB}
                ORDER BY sub.salon_id, sub.created_at DESC
             ) x
             LEFT JOIN subscription_plans sp ON sp.id = x.plan_id
            GROUP BY 1 ORDER BY 2 DESC`
        ),
      [] as any[]
    ),

    // ── Recent activity: newest few of each kind, merged below ──────────────────
    (async () => {
      const [salons, payments, issues, tickets, announcements] = await Promise.all([
        guarded(() => rows(`SELECT COALESCE(s.business_name, s.slug, 'Unnamed') AS sub, s.created_at AS at FROM salons s WHERE ${REAL_SALON} ORDER BY s.created_at DESC LIMIT 4`), [] as any[]),
        guarded(() => rows(`SELECT p.net_amount AS amount, COALESCE(s.business_name, s.slug, 'Unnamed') AS salon, p.created_at AS at FROM payments p JOIN salons s ON s.id = p.salon_id WHERE ${REAL_SALON} AND p.status IN ('completed','partial') ORDER BY p.created_at DESC LIMIT 4`), [] as any[]),
        guarded(() => rows(`SELECT r.req_number, r.status, r.title, r.updated_at AS at FROM client_requirements r ORDER BY r.updated_at DESC LIMIT 4`), [] as any[]),
        guarded(() => rows(`SELECT t.subject, COALESCE(s.business_name, s.slug, 'Unnamed') AS salon, t.created_at AS at FROM support_tickets t LEFT JOIN salons s ON s.id = t.salon_id ORDER BY t.created_at DESC LIMIT 4`), [] as any[]),
        guarded(() => rows(`SELECT message, created_at AS at FROM deployment_announcements ORDER BY created_at DESC LIMIT 3`), [] as any[]),
      ]);
      // Some created_at columns are timestamp-without-tz (UTC): normalise so the browser reads them correctly.
      const at = (v: unknown) => {
        if (v instanceof Date) return v.toISOString();
        let t = String(v).trim().replace(" ", "T");
        if (/[+-]\d\d$/.test(t)) t += ":00"; // "+00" -> "+00:00"
        if (!/(Z|[+-]\d\d:?\d\d)$/i.test(t)) t += "Z";
        const d = new Date(t);
        return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      };
      const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
      const reqNo = (n: unknown) => `REQ-${String(n ?? "").padStart(3, "0")}`;
      const statusLabel: Record<string, string> = { open: "Open", in_progress: "In Progress", completed: "Completed" };
      return [
        ...salons.map((r) => ({ type: "salon", title: "New salon registered", sub: r.sub, at: at(r.at) })),
        ...payments.map((r) => ({ type: "payment", title: "Payment received", sub: `${inr(r.amount)} from ${r.salon}`, at: at(r.at) })),
        ...issues.map((r) => ({ type: "issue", title: "Issue updated", sub: `${reqNo(r.req_number)} is ${statusLabel[r.status] ?? r.status} · ${r.title}`, at: at(r.at) })),
        ...tickets.map((r) => ({ type: "ticket", title: "New support ticket", sub: `${r.subject} · ${r.salon}`, at: at(r.at) })),
        ...announcements.map((r) => ({ type: "announcement", title: "Deployment announcement", sub: String(r.message ?? "").slice(0, 90), at: at(r.at) })),
      ]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 6);
    })(),

    // ── Issue Tracker workload: open issues per developer ───────────────────────
    guarded(
      () =>
        rows(
          `SELECT d.name, COUNT(*)::int AS count
             FROM client_requirement_assignees a
             JOIN client_requirements r ON r.id = a.requirement_id AND r.status <> 'completed'
             JOIN developers d ON d.id = a.developer_id
            GROUP BY d.id, d.name ORDER BY count DESC, d.name LIMIT 5`
        ),
      [] as any[]
    ),

    // ── Most active salons in the selected range (bookings created) ─────────────
    guarded(
      () =>
        rows(
          `SELECT s.id, COALESCE(s.business_name, s.slug, 'Unnamed') AS name,
                  GREATEST((SELECT COUNT(*)::int FROM branches b WHERE b.salon_id = s.id), 1) AS branches,
                  (SELECT COUNT(*)::int FROM staff st WHERE st.salon_id = s.id) AS staff,
                  COUNT(a.id)::int AS bookings
             FROM salons s JOIN appointments a ON a.salon_id = s.id
                  AND a.created_at >= NOW() - make_interval(days => $1::int)
            WHERE ${REAL_SALON}
            GROUP BY s.id ORDER BY bookings DESC, name LIMIT 5`,
          [activeDays]
        ),
      [] as any[]
    ),

    guarded(() => botQuestionsRepository.stats(), { unanswered: 0 } as any),
  ]);

  const issueUnassigned = Number(issueTotals.unassigned) || 0;

  return {
    range: { from, to, days: span, prev_from: prevFrom, prev_to: prevTo },
    kpis: {
      salons: {
        value: salonTotals.total, delta: pct(salonTotals.cur, salonTotals.prev), new_in_range: salonTotals.cur, series: salonSeries,
      },
      subscriptions: {
        value: subTotals.active, delta: pct(subTotals.cur, subTotals.prev), expiring_7d: subTotals.expiring, series: subSeries,
      },
      revenue: {
        value: revenueTotals.cur, delta: pct(revenueTotals.cur, revenueTotals.prev), series: revenueSeries,
      },
      issues: {
        value: issueTotals.open, delta: pct(issueTotals.cur, issueTotals.prev), high_priority: issueTotals.high, series: issueSeries,
      },
      tickets: {
        value: ticketTotals.open, delta: pct(ticketTotals.cur, ticketTotals.prev), high_priority: ticketTotals.high, series: ticketSeries,
      },
    },
    attention: {
      expiring_7d: subTotals.expiring,
      no_plan: attention.no_plan,
      unassigned_issues: issueUnassigned,
      failed_payments: revenueTotals.failed,
      unanswered_chatbot: Number((botStats as any).unanswered) || 0,
    },
    monthly: monthly.map((m: any) => ({ label: m.label, month: m.month, salons: m.salons, revenue: Number(m.revenue) })),
    plans,
    activity,
    issues: {
      open: issueTotals.s_open,
      in_progress: issueTotals.s_progress,
      completed: issueTotals.s_done,
      by_developer: [
        ...issueByDev,
        ...(issueUnassigned > 0 ? [{ name: "Unassigned", count: issueUnassigned, unassigned: true }] : []),
      ],
    },
    active_salons: activeSalons,
    active_days: activeDays,
  };
}
