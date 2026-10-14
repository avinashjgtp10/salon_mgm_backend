import { salonDashboardRepository } from "./salon-dashboard.repository";
import { reportsRepository } from "../reports/reports.repository";

// Single source of truth for revenue shown OUTSIDE the salon's own dashboard
// (Super Admin, Branch Owner). The salon dashboard / Sales Summary report is
// the reference: those two already agree with each other, while Super Admin
// (SUM of payments.net_amount) and Branch Owner (ROUND(sales.total_amount),
// dated by sales.created_at) each used their own formula and drifted away from
// it for the same salon. Everything here delegates to the very same functions
// the salon site calls, so the figures cannot diverge again.

const CONCURRENCY = 4;
const ALL_TIME_TTL_MS = 60_000;

const allTimeCache = new Map<string, { at: number; value: number }>();

// Runs `fn` over `items` with a small concurrency cap — each revenue figure is
// a multi-join query, so firing one per salon at once would swamp the pool.
async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** All-time revenue per salon = the Sales Summary report's "Received Amount"
 *  (what the salon dashboard exposes as allTimeRevenue). Cached for a minute so
 *  list pages don't recompute every salon on each load. Salons whose query
 *  fails are simply absent from the map (callers keep their previous value). */
export async function getAllTimeRevenueBySalon(salonIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const now = Date.now();
  const missing: string[] = [];
  for (const id of salonIds) {
    const hit = allTimeCache.get(id);
    if (hit && now - hit.at < ALL_TIME_TTL_MS) result.set(id, hit.value);
    else missing.push(id);
  }
  await mapLimit(missing, async (id) => {
    try {
      const stats = await reportsRepository.getSalesSummaryReportStats(id, { payment_statuses: ["paid", "partial"] });
      const value = Number(stats.received_amount) || 0;
      allTimeCache.set(id, { at: Date.now(), value });
      result.set(id, value);
    } catch {
      /* leave out — caller falls back */
    }
  });
  return result;
}

export interface SalonRevenueFigures {
  /** This calendar month (IST) — the salon dashboard's "Total Revenue" card. */
  thisMonth: number;
  today: number;
  allTime: number;
  newClientsToday: number;
  appointmentsToday: number;
}

/** Month / today / all-time per salon, straight from the salon dashboard's own
 *  getSummary() so every portal shows the figure the salon itself sees. */
export async function getRevenueFiguresBySalon(salonIds: string[]): Promise<Map<string, SalonRevenueFigures>> {
  const result = new Map<string, SalonRevenueFigures>();
  await mapLimit(salonIds, async (id) => {
    try {
      const s = await salonDashboardRepository.getSummary(id);
      result.set(id, {
        thisMonth: s.totalRevenue, today: s.todayRevenue, allTime: s.allTimeRevenue,
        newClientsToday: s.newClientsToday, appointmentsToday: s.todayAppointmentsCount,
      });
    } catch {
      /* leave out — caller falls back */
    }
  });
  return result;
}
