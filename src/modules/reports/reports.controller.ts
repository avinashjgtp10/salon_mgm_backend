import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response.util";
import { reportsService } from "./reports.service";

type AuthRequest = Request & {
  user?: { userId: string; role?: string; salonId?: string };
};

function resolveSalonId(req: AuthRequest): string {
  return req.user?.salonId ?? "";
}

export const reportsController = {

  // GET /api/v1/reports?search=&category=
  async getReportsDashboard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { search = "", category = "all" } = req.query as Record<string, string>;
      const reportsDashboard = await reportsService.getReportsDashboard(salonId, search, category);
      return res.status(200).json({
        success: true,
        message: "Reports dashboard fetched successfully",
        timestamp: new Date().toISOString(),
        reportsDashboard,
      });
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/revenue?period=7d[&from=YYYY-MM-DD&to=YYYY-MM-DD]
  async getRevenue(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { period = "30d", from, to } = req.query as Record<string, string>;
      const data = await reportsService.getRevenue(salonId, period, from, to);
      return sendSuccess(res, 200, data, "Revenue report fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/appointments?period=7d
  async getAppointments(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { period = "30d", from, to } = req.query as Record<string, string>;
      const data = await reportsService.getAppointments(salonId, period, from, to);
      return sendSuccess(res, 200, data, "Appointments report fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/clients?period=7d
  async getClients(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { period = "30d", from, to } = req.query as Record<string, string>;
      const data = await reportsService.getClients(salonId, period, from, to);
      return sendSuccess(res, 200, data, "Clients report fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/staff?period=7d
  async getStaff(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { period = "30d", from, to } = req.query as Record<string, string>;
      const data = await reportsService.getStaff(salonId, period, from, to);
      return sendSuccess(res, 200, data, "Staff report fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/services?period=7d
  async getServices(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { period = "30d", from, to } = req.query as Record<string, string>;
      const data = await reportsService.getServices(salonId, period, from, to);
      return sendSuccess(res, 200, data, "Services report fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/export?tab=revenue&period=7d&format=excel
  async exportReport(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const { tab = "revenue", period = "30d", format = "csv", from, to } =
        req.query as Record<string, string>;

      const { headers, rows } = await reportsService.exportReport(
        salonId, tab, period, format, from, to,
      );

      const escape = (v: string | number) => {
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        headers.map(escape).join(","),
        ...rows.map(r => r.map(escape).join(",")),
      ].join("\r\n");

      const ext      = format === "excel" ? "xlsx" : "csv";
      const filename = `report-${tab}-${period}.${ext}`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/appointments/detail
  async getAppointmentsDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        dateType = "appointment",
        from     = new Date().toISOString().slice(0, 10),
        to       = new Date().toISOString().slice(0, 10),
        statuses = "",
        sources  = "",  // FIX #5: now forwarded
      } = req.query as Record<string, string>;
      const statusList = statuses ? statuses.split(",").filter(Boolean) : [];
      const sourceList = sources  ? sources.split(",").filter(Boolean)  : [];
      const data = await reportsService.getAppointmentsDetail(
        salonId, dateType, from, to, statusList, sourceList,
      );
      return sendSuccess(res, 200, data, "Appointment detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/finance/detail
  async getFinanceDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from   = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to     = new Date().toISOString().slice(0, 10),
        method = "All",
      } = req.query as Record<string, string>;
      const data = await reportsService.getFinanceDetail(salonId, from, to, method);
      return sendSuccess(res, 200, data, "Finance detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/inventory/detail?category=All&status=All
  async getInventoryDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        category = "All",
        status   = "All",
      } = req.query as Record<string, string>;
      const data = await reportsService.getInventoryDetail(salonId, category, status);
      return sendSuccess(res, 200, data, "Inventory detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/payments/detail?from=&to=&gateway=All&status=All
  async getPaymentsDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from    = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to      = new Date().toISOString().slice(0, 10),
        gateway = "All",
        status  = "All",
      } = req.query as Record<string, string>;
      const data = await reportsService.getPaymentsDetail(salonId, from, to, gateway, status);
      return sendSuccess(res, 200, data, "Payments detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/daily/detail?date=&service=All&staff=All
  async getDailyDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        date    = new Date().toISOString().slice(0, 10),
        service = "All",
        staff   = "All",
      } = req.query as Record<string, string>;
      const data = await reportsService.getDailyDetail(salonId, date, service, staff);
      return sendSuccess(res, 200, data, "Daily detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/marketing/detail?from=&to=&status=All&search=
  async getMarketingDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from   = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to     = new Date().toISOString().slice(0, 10),
        status = "All",
        search = "",
      } = req.query as Record<string, string>;
      const data = await reportsService.getMarketingDetail(salonId, from, to, status, search);
      return sendSuccess(res, 200, data, "Marketing detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/employee/detail
  async getEmployeeDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from       = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to         = new Date().toISOString().slice(0, 10),
        role       = "All",
        department = "All",
      } = req.query as Record<string, string>;
      const data = await reportsService.getEmployeeDetail(salonId, from, to, role, department);
      return sendSuccess(res, 200, data, "Employee detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/client-retention/detail?inactiveDays=30&from=&to=
  async getClientRetentionDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        inactiveDays = "30",
        from,
        to,
      } = req.query as Record<string, string>;
      const data = await reportsService.getClientRetentionDetail(
        salonId, parseInt(inactiveDays, 10) || 30, from, to,
      );
      return sendSuccess(res, 200, data, "Client retention detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/inventory-consumption/detail?from=&to=&type=All
  async getInventoryConsumptionDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to   = new Date().toISOString().slice(0, 10),
        type = "All",
      } = req.query as Record<string, string>;
      const data = await reportsService.getInventoryConsumptionDetail(salonId, from, to, type);
      return sendSuccess(res, 200, data, "Inventory consumption detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/payment-summary/detail?from=&to=
  async getPaymentSummaryDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to   = new Date().toISOString().slice(0, 10),
      } = req.query as Record<string, string>;
      const data = await reportsService.getPaymentSummaryDetail(salonId, from, to);
      return sendSuccess(res, 200, data, "Payment summary detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/commissions/detail?from=&to=
  async getCommissionsDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to   = new Date().toISOString().slice(0, 10),
      } = req.query as Record<string, string>;
      const data = await reportsService.getCommissionsDetail(salonId, from, to);
      return sendSuccess(res, 200, data, "Commissions detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/no-show/detail?from=&to=
  async getNoShowCancellationDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from = new Date().toISOString().slice(0, 10),
        to   = new Date().toISOString().slice(0, 10),
      } = req.query as Record<string, string>;
      const data = await reportsService.getNoShowCancellationDetail(salonId, from, to);
      return sendSuccess(res, 200, data, "No-show/cancellation detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/staffing/detail
  async getStaffingDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const data = await reportsService.getStaffingDetail(salonId);
      return sendSuccess(res, 200, data, "Staffing detail fetched");
    } catch (err) { return next(err); }
  },

  // GET /api/v1/reports/leaves/detail?from=&to=
  async getLeavesDetail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = resolveSalonId(req);
      const {
        from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
        to   = new Date().toISOString().slice(0, 10),
      } = req.query as Record<string, string>;
      const data = await reportsService.getLeavesDetail(salonId, from, to);
      return sendSuccess(res, 200, data, "Leaves detail fetched");
    } catch (err) { return next(err); }
  },
};