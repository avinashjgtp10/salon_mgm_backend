import { AppError } from "../../middleware/error.middleware";
import { salonDashboardRepository } from "./salon-dashboard.repository";
import type {
  DashboardSummary,
  RevenueDataPoint,
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
