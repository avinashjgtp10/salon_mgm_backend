import { AppError } from "../../middleware/error.middleware";
import { salonDashboardRepository } from "./salon-dashboard.repository";
import type {
  DashboardSummary,
  TodayAppointment,
  RevenueDataPoint,
  TopStaffMember,
  ServiceMixItem,
  DashboardService,
  DashboardAll,
} from "./salon-dashboard.types";

export const salonDashboardService = {
  async getSummary(salonId: string): Promise<DashboardSummary> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getSummary(salonId);
  },

  async getTodayAppointments(salonId: string, date?: string): Promise<TodayAppointment[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getTodayAppointments(salonId, date);
  },

  async getRevenueChart(salonId: string, period?: string): Promise<RevenueDataPoint[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getRevenueChart(salonId, period);
  },

  async getTopStaff(salonId: string): Promise<TopStaffMember[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getTopStaff(salonId);
  },

  async getServiceMix(salonId: string): Promise<ServiceMixItem[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getServiceMix(salonId);
  },

  async getServices(salonId: string): Promise<DashboardService[]> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getServices(salonId);
  },

  async getAll(salonId: string, period?: string, date?: string): Promise<DashboardAll> {
    if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
    return salonDashboardRepository.getAll(salonId, period, date);
  },
};
