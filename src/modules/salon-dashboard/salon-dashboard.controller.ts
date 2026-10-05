import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { salonDashboardService } from "./salon-dashboard.service";
import { getSalonId } from "../utils/salon.util";
import { staffHasPermission } from "../../middleware/permission.middleware";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

// Used by cash-management.controller.ts's own summary-bundle endpoint
// (a different dashboard surface, gated on the original view_dashboard_
// financials key — unrelated to getCombined()'s per-card redaction below).
const FINANCIAL_SUMMARY_FIELDS = [
  "totalRevenue", "allTimeRevenue", "lastMonthRevenue", "yesterdayRevenue",
  "todayRevenue", "revenueChange", "todayRevenueChange",
] as const;

// Total Revenue card's fields (This Month / Last Month faces).
const TOTAL_REVENUE_SUMMARY_FIELDS = ["totalRevenue", "allTimeRevenue", "lastMonthRevenue", "revenueChange"] as const;
// Today's Revenue card's fields (Today / Yesterday faces).
const TODAY_REVENUE_SUMMARY_FIELDS = ["todayRevenue", "yesterdayRevenue", "todayRevenueChange"] as const;
const NEW_CLIENTS_SUMMARY_FIELDS = ["newClientsToday", "newClientsThisMonth"] as const;

// Owner/admin bypass (unconditional, matching every other permission check
// in the app); staff resolved against the real permission tables/blob via
// staffHasPermission. GET /dashboard/all bundles financial, staff-
// performance and client-PII data in one response — there's no separate
// route per sub-section to gate at the middleware level (see
// salon-dashboard.routes.ts), so this redacts fields in place instead.
export async function checkDashboardSubPermission(req: AuthRequest, permKey: string): Promise<boolean> {
  const role = req.user?.role;
  if (role === "salon_owner" || role === "admin") return true;
  const userId = req.user?.userId;
  const salonId = req.user?.salonId;
  if (!userId || !salonId) return false;
  return staffHasPermission({ userId, role, salonId }, permKey);
}

function redactSummaryFields(summary: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const redacted = { ...summary };
  for (const field of fields) {
    if (field in redacted) redacted[field] = null;
  }
  return redacted;
}

export function redactFinancialSummaryFields(summary: Record<string, unknown>): Record<string, unknown> {
  return redactSummaryFields(summary, FINANCIAL_SUMMARY_FIELDS);
}

// Flattened, not emptied — the frontend chart is expected to still render
// its container/labels/period toggle with a masked appearance (equal-height
// points), not disappear into an empty state. Keeps month/fullLabel (time
// labels, not financial) and zeroes only the value field the shape is drawn
// from.
function redactRevenueChart(chart: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return chart.map((pt) => ({ ...pt, revenue: 1 }));
}

function redactPaymentModeBreakdown(): Record<string, unknown> {
  return { entries: [], total: 0 };
}

// count stays real — it's "how many clients", not a currency figure, and
// zeroing it previously made a masked Due Amount card read as "0 clients"
// (looks like nothing is due, not "hidden"). amount is a non-null dummy (not
// null) so the frontend's fmt() still calls formatAmount() and renders the
// masked placeholder text instead of falling back to its own "no value" dash.
function redactPendingPayments(pendingPayments: { count?: number; amount?: number } | undefined) {
  return { count: pendingPayments?.count ?? 0, amount: 0 };
}

export const salonDashboardController = {
  async getRevenueChart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const gender = typeof req.query.gender === "string" ? req.query.gender : undefined;
      const data = await salonDashboardService.getRevenueChart(salonId, period, gender);
      return sendSuccess(res, 200, data, "Revenue chart data fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  // GET /api/v1/dashboard/monthly-projection — "Monthly Projection & Growth"
  // card (replaced Revenue Overview; same card permission). Figures are
  // zeroed for a user without view_dashboard_financials, mirroring what the
  // other dashboard cards redact, so the response never carries the real
  // numbers just because the frontend masks them.
  async getMonthlyProjection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const gender = typeof req.query.gender === "string" ? req.query.gender : undefined;
      const data = await salonDashboardService.getMonthlyProjection(salonId, gender);
      const canFinancials = await checkDashboardSubPermission(req, "view_dashboard_financials");
      if (!canFinancials) {
        return sendSuccess(res, 200, {
          ...data,
          mtdSales: 0, lmmtdSales: 0, projectedSales: 0, growthPct: null,
          target: data.target != null ? 0 : null, achievedPct: null,
          remainingTarget: null, requiredDailySales: null,
          todaySales: 0, dayAbv: null, monthAbv: null,
          daily: data.daily.map((d) => ({ day: d.day, sales: 0 })),
        }, "Monthly projection fetched successfully");
      }
      return sendSuccess(res, 200, data, "Monthly projection fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  // PUT /api/v1/dashboard/monthly-target — owner/admin only (see routes).
  async setMonthlyTarget(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      await salonDashboardService.setMonthlyTarget(salonId, req.body?.target);
      return sendSuccess(res, 200, null, "Monthly target saved successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getPaymentModeBreakdown(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const data = await salonDashboardService.getPaymentModeBreakdown(salonId, period);
      return sendSuccess(res, 200, data, "Payment mode breakdown fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getTopStaff(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await salonDashboardService.getTopStaff(salonId);
      return sendSuccess(res, 200, data, "Top staff fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getStaffRevenue(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const data = await salonDashboardService.getStaffRevenue(salonId, period);
      return sendSuccess(res, 200, data, "Staff revenue fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getServiceMix(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await salonDashboardService.getServiceMix(salonId);
      return sendSuccess(res, 200, data, "Service mix fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/v1/dashboard/combined — bundles the KPI summary, live today's
  // appointments, revenue chart, pending payments, today's birthdays, and the
  // Overall Collection payment-mode breakdown into one call, so the
  // dashboard page's initial load (and every Overall Collection filter
  // change) is a single request instead of three separate ones. Body params,
  // not query, since this can carry the Overall Collection filter too.
  async getCombined(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const body = req.body ?? {};
      const period = typeof body.period === "string" ? body.period : undefined;
      const date = typeof body.date === "string" ? body.date : undefined;
      const collectionPeriod = typeof body.collectionPeriod === "string" ? body.collectionPeriod : undefined;
      const data = await salonDashboardService.getCombined(salonId, period, date, collectionPeriod) as any;

      const [
        canTotalRevenue, canTodayRevenue, canDueAmount, canAppointments,
        canBirthdays, canAnniversaries, canNewClients, canRevenueOverview, canOverallCollection,
      ] = await Promise.all([
        checkDashboardSubPermission(req, "view_dashboard_card_total_revenue"),
        checkDashboardSubPermission(req, "view_dashboard_card_today_revenue"),
        checkDashboardSubPermission(req, "view_dashboard_card_due_amount"),
        checkDashboardSubPermission(req, "view_dashboard_card_appointments"),
        checkDashboardSubPermission(req, "view_dashboard_card_birthdays"),
        checkDashboardSubPermission(req, "view_dashboard_card_anniversaries"),
        checkDashboardSubPermission(req, "view_dashboard_card_new_clients"),
        checkDashboardSubPermission(req, "view_dashboard_card_revenue_overview"),
        checkDashboardSubPermission(req, "view_dashboard_card_overall_collection"),
      ]);

      if (!canTotalRevenue) {
        data.summary = redactSummaryFields(data.summary, TOTAL_REVENUE_SUMMARY_FIELDS);
      }
      if (!canTodayRevenue) {
        data.summary = redactSummaryFields(data.summary, TODAY_REVENUE_SUMMARY_FIELDS);
      }
      if (!canDueAmount) {
        data.pendingPayments = redactPendingPayments(data.pendingPayments);
      }
      if (!canAppointments) {
        data.todayAppointments = [];
      }
      if (!canBirthdays) {
        data.todaysBirthdays = { clients: [] };
      }
      if (!canAnniversaries) {
        data.todaysAnniversaries = { clients: [] };
      }
      if (!canNewClients) {
        data.summary = redactSummaryFields(data.summary, NEW_CLIENTS_SUMMARY_FIELDS);
      }
      if (!canRevenueOverview) {
        data.revenueChart = redactRevenueChart(data.revenueChart ?? []);
      }
      if (!canOverallCollection) {
        data.paymentModeBreakdown = redactPaymentModeBreakdown();
      }

      return sendSuccess(res, 200, data, "Dashboard data fetched successfully");
    } catch (err) {
      return next(err);
    }
  },
};
