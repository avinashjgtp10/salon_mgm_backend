import { AppError } from "../../middleware/error.middleware";
import { salonDashboardRepository } from "./salon-dashboard.repository";
import type {
  DashboardSummary,
  TodayAppointment,
  RevenueDataPoint,
  TopStaffMember,
  ServiceMixItem,
} from "./salon-dashboard.types";

export const salonDashboardService = {
  async getSummary(salonId: string): Promise<DashboardSummary> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getSummary(salonId);
  },

  async getTodayAppointments(salonId: string): Promise<TodayAppointment[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getTodayAppointments(salonId);
  },

  async getRevenueChart(salonId: string): Promise<RevenueDataPoint[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getRevenueChart(salonId);
  },

  async getTopStaff(salonId: string): Promise<TopStaffMember[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getTopStaff(salonId);
  },

  async getServiceMix(salonId: string): Promise<ServiceMixItem[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getServiceMix(salonId);
  },
};
