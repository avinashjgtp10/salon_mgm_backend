import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { salonDashboardService } from "./salon-dashboard.service";
import { getSalonId } from "../utils/salon.util";
import { staffHasPermission } from "../../middleware/permission.middleware";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

const FINANCIAL_SUMMARY_FIELDS = [
  "totalRevenue", "allTimeRevenue", "lastMonthRevenue", "yesterdayRevenue",
  "todayRevenue", "revenueChange", "todayRevenueChange",
] as const;

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

export function redactFinancialSummaryFields(summary: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...summary };
  for (const field of FINANCIAL_SUMMARY_FIELDS) {
    if (field in redacted) redacted[field] = null;
  }
  return redacted;
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

      const [canFinancials, canAppointments, canClientInfo] = await Promise.all([
        checkDashboardSubPermission(req, "view_dashboard_financials"),
        checkDashboardSubPermission(req, "view_dashboard_appointments"),
        checkDashboardSubPermission(req, "view_dashboard_client_info"),
      ]);

      if (!canFinancials) {
        data.summary = redactFinancialSummaryFields(data.summary);
        data.revenueChart = redactRevenueChart(data.revenueChart ?? []);
        data.paymentModeBreakdown = redactPaymentModeBreakdown();
        // count stays real — it's "how many clients", not a ₹ figure, and
        // zeroing it previously made a masked Due Amount card read as "0
        // clients" (looks like nothing is due, not "hidden"). amount is a
        // non-null dummy (not null) so the frontend's fmt() still calls
        // formatAmount() and renders the masked placeholder text instead of
        // falling back to its own "no value" dash.
        data.pendingPayments = { count: data.pendingPayments?.count ?? 0, amount: 0 };
      }
      if (!canAppointments) {
        data.todayAppointments = [];
      }
      if (!canClientInfo) {
        data.todaysBirthdays = { clients: [] };
      }

      return sendSuccess(res, 200, data, "Dashboard data fetched successfully");
    } catch (err) {
      return next(err);
    }
  },
};
