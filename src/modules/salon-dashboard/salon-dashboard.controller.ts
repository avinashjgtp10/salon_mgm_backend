import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { salonDashboardService } from "./salon-dashboard.service";
import { getSalonId } from "../utils/salon.util";
import { staffHasPermission } from "../../middleware/permission.middleware";
import type { MonthlyProjection } from "./salon-dashboard.types";

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

// Zeroes every money figure (keeps day/count/label fields) so a user without
// view_dashboard_financials never receives the real numbers, only the masked
// card shape. Shared by GET /monthly-projection and the combined bundle.
function redactMonthlyProjection<T extends MonthlyProjection>(data: T): T {
  return {
    ...data,
    mtdSales: 0, lmmtdSales: 0, projectedSales: 0, growthPct: null,
    target: data.target != null ? 0 : null, achievedPct: null,
    remainingTarget: null, requiredDailySales: null,
    todaySales: 0, dayAbv: null, monthAbv: null,
    daily: data.daily.map((d) => ({ day: d.day, sales: 0 })),
  };
}

// The permission behind "See Revenue Amount in Number Form". Without it every revenue figure is removed from the response (not
// just masked on screen), so it cannot be read from the network tab.
const REVENUE_AMOUNT_PERMISSION = "view_dashboard_revenue_amount";
const canSeeRevenueAmounts = (req: AuthRequest) => checkDashboardSubPermission(req, REVENUE_AMOUNT_PERMISSION);

const redactMoneyList = <T extends { revenue?: number }>(rows: T[]): T[] => rows.map((r) => ({ ...r, revenue: 0 }));

// Appointment rows carry prices, tax, totals and tips. Zeroed here so the Today's Appointments list cannot be used to
// work out revenue; names, times, services and statuses are untouched.
const APPOINTMENT_ITEM_ARRAYS = ["services", "package_items", "product_items", "membership_items"] as const;
function redactAppointmentAmounts(rows: any[]): any[] {
  return (rows ?? []).map((appt) => {
    const out: any = { ...appt };
    for (const key of Object.keys(out)) {
      if (typeof out[key] === "number" && /(amount|total|paid|price|due|balance|tip|discount)/i.test(key)) out[key] = 0;
    }
    out.tax_breakdown = null;
    for (const arr of APPOINTMENT_ITEM_ARRAYS) {
      if (Array.isArray(out[arr])) out[arr] = out[arr].map((it: any) => ({ ...it, price: 0, ...(it?.tax_amount != null ? { tax_amount: 0 } : {}) }));
    }
    return out;
  });
}

export const salonDashboardController = {
  async getRevenueChart(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const period = typeof req.query.period === "string" ? req.query.period : undefined;
      const gender = typeof req.query.gender === "string" ? req.query.gender : undefined;
      const data = await salonDashboardService.getRevenueChart(salonId, period, gender);
      if (!(await canSeeRevenueAmounts(req))) return sendSuccess(res, 200, redactRevenueChart(data as any) as any, "Revenue chart data fetched successfully");
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
      const canFinancials = await canSeeRevenueAmounts(req);
      if (!canFinancials) {
        return sendSuccess(res, 200, redactMonthlyProjection(data), "Monthly projection fetched successfully");
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
      if (!(await canSeeRevenueAmounts(req))) return sendSuccess(res, 200, redactPaymentModeBreakdown(), "Payment mode breakdown fetched successfully");
      return sendSuccess(res, 200, data, "Payment mode breakdown fetched successfully");
    } catch (err) {
      return next(err);
    }
  },

  async getTopStaff(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await getSalonId(req);
      const data = await salonDashboardService.getTopStaff(salonId);
      if (!(await canSeeRevenueAmounts(req))) return sendSuccess(res, 200, redactMoneyList(data as any), "Top staff fetched successfully");
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
      if (!(await canSeeRevenueAmounts(req))) return sendSuccess(res, 200, redactMoneyList(data as any), "Staff revenue fetched successfully");
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
      // Monthly Projection card's own gender filter ("all" / "male" / "female").
      const gender = typeof body.gender === "string" ? body.gender : undefined;
      const data = await salonDashboardService.getCombined(salonId, period, date, collectionPeriod, gender) as any;

      const [
        canFinancials, canTotalRevenue, canTodayRevenue, canDueAmount, canAppointments,
        canBirthdays, canAnniversaries, canNewClients, canRevenueOverview, canOverallCollection,
      ] = await Promise.all([
        canSeeRevenueAmounts(req),
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

      // No number-form permission: every revenue figure leaves the response, whatever the card permissions say.
      if (!canFinancials) {
        data.summary = redactFinancialSummaryFields(data.summary);
        data.pendingPayments = redactPendingPayments(data.pendingPayments);
        data.revenueChart = redactRevenueChart(data.revenueChart ?? []);
        data.paymentModeBreakdown = redactPaymentModeBreakdown();
        data.todayAppointments = redactAppointmentAmounts(data.todayAppointments);
        if (data.topStaff) data.topStaff = redactMoneyList(data.topStaff);
        if (data.staffRevenue) data.staffRevenue = redactMoneyList(data.staffRevenue);
      }
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
      // Same gates the standalone /monthly-projection route used: the card
      // permission to see it at all, view_dashboard_financials for real money.
      if (data.monthlyProjection && (!canRevenueOverview || !canFinancials)) {
        data.monthlyProjection = redactMonthlyProjection(data.monthlyProjection);
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
