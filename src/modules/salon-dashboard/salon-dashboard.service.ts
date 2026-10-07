import { AppError } from "../../middleware/error.middleware";
import { salonDashboardRepository } from "./salon-dashboard.repository";
import type {
  DashboardSummary,
  RevenueDataPoint,
  MonthlyProjection,
  PaymentModeBreakdown,
  TopStaffMember,
  StaffRevenueEntry,
  ServiceMixItem,
  DashboardCombined,
} from "./salon-dashboard.types";

export const salonDashboardService = {
  async getSummary(salonId: string): Promise<DashboardSummary> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getSummary(salonId);
  },

  async getRevenueChart(salonId: string, period?: string, gender?: string): Promise<RevenueDataPoint[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getRevenueChart(salonId, period, gender);
  },

  async getMonthlyProjection(salonId: string, gender?: string): Promise<MonthlyProjection> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getMonthlyProjection(salonId, gender);
  },

  async setMonthlyTarget(salonId: string, target: unknown): Promise<void> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    // null / "" clears the target; otherwise a positive, sane number.
    if (target === null || target === "" || target === undefined) {
      return salonDashboardRepository.setMonthlyTarget(salonId, null);
    }
    const n = Number(target);
    if (!Number.isFinite(n) || n <= 0 || n > 99_999_999_999) {
      throw new AppError(400, "target must be a positive number", "VALIDATION_ERROR");
    }
    return salonDashboardRepository.setMonthlyTarget(salonId, Math.round(n * 100) / 100);
  },

  async getPaymentModeBreakdown(salonId: string, period?: string): Promise<PaymentModeBreakdown> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getPaymentModeBreakdown(salonId, period);
  },

  async getTopStaff(salonId: string): Promise<TopStaffMember[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getTopStaff(salonId);
  },

  async getStaffRevenue(salonId: string, period?: string): Promise<StaffRevenueEntry[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getStaffRevenue(salonId, period);
  },

  async getServiceMix(salonId: string): Promise<ServiceMixItem[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getServiceMix(salonId);
  },

  async getCombined(
    salonId: string,
    period?: string,
    date?: string,
    collectionPeriod?: string,
  ): Promise<DashboardCombined> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getCombined(salonId, period, date, collectionPeriod);
  },
};
