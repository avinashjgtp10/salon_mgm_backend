import { AppError } from "../../middleware/error.middleware";
import { reportsRepository } from "./reports.repository";
import type { ReportPeriod, ReportTab } from "./reports.types";

const VALID_PERIODS: ReportPeriod[] = ["7d", "30d", "90d", "12m", "custom"];
const VALID_TABS:    ReportTab[]    = ["revenue", "appointments", "clients", "staff", "services"];

function assertSalonId(salonId: string) {
  if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
}

function assertPeriod(period: string, from?: string, to?: string): ReportPeriod {
  if (period === "custom" && from && to) return "custom";
  if (!VALID_PERIODS.includes(period as ReportPeriod))
    throw new AppError(400, `period must be one of: ${VALID_PERIODS.join(", ")}`, "VALIDATION_ERROR");
  return period as ReportPeriod;
}

export const reportsService = {
  async getRevenue(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getRevenue(salonId, assertPeriod(period, from, to), from, to);
  },

  async getAppointments(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getAppointments(salonId, assertPeriod(period, from, to), from, to);
  },

  async getClients(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getClients(salonId, assertPeriod(period, from, to), from, to);
  },

  async getStaff(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getStaff(salonId, assertPeriod(period, from, to), from, to);
  },

  async getServices(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getServices(salonId, assertPeriod(period, from, to), from, to);
  },

  async exportReport(
    salonId: string, tab: string, period: string, format: string,
    from?: string, to?: string,
  ) {
    assertSalonId(salonId);
    if (!VALID_TABS.includes(tab as ReportTab))
      throw new AppError(400, `tab must be one of: ${VALID_TABS.join(", ")}`, "VALIDATION_ERROR");
    if (!["excel", "csv"].includes(format))
      throw new AppError(400, "format must be excel or csv", "VALIDATION_ERROR");
    return reportsRepository.getExportData(salonId, tab, assertPeriod(period, from, to), from, to);
  },

  async getAppointmentsDetail(
    salonId: string,
    dateType: string, from: string, to: string,
    statuses: string[],
  ) {
    assertSalonId(salonId);
    return reportsRepository.getAppointmentsDetail(salonId, dateType, from, to, statuses);
  },

  async getFinanceDetail(salonId: string, from: string, to: string, method: string) {
    assertSalonId(salonId);
    return reportsRepository.getFinanceDetail(salonId, from, to, method);
  },

  async getEmployeeDetail(salonId: string, from: string, to: string, role: string) {
    assertSalonId(salonId);
    return reportsRepository.getEmployeeDetail(salonId, from, to, role);
  },
};
