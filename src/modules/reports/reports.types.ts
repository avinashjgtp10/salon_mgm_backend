export type ReportPeriod = "7d" | "30d" | "90d" | "12m" | "custom";
export type ReportTab = "revenue" | "appointments" | "clients" | "staff" | "services";

// ── Revenue ───────────────────────────────────────────────────────────────────
export interface RevenueTrendPoint {
  label: string;
  revenue: number;
  target: number;
  prev: number;
}

export interface RevenueKPI {
  totalRevenue: number;
  avgDailyRevenue: number;
  bestDayRevenue: number;
  targetAchieved: number;
  changes: {
    totalRevenue: number;
    avgDailyRevenue: number;
    bestDayRevenue: number;
    targetAchieved: number;
  };
}

export interface RevenueReport {
  trend: RevenueTrendPoint[];
  kpi: RevenueKPI;
}

// ── Appointments ──────────────────────────────────────────────────────────────
export interface AppointmentVolumePoint {
  label: string;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface AppointmentsKPI {
  totalBookings: number;
  completionRate: number;
  cancellationRate: number;
  avgDuration: number;
  changes: {
    totalBookings: number;
    completionRate: number;
    cancellationRate: number;
    avgDuration: number;
  };
}

export interface AppointmentsReport {
  volume: AppointmentVolumePoint[];
  kpi: AppointmentsKPI;
  peakHours: { hour: string; count: number }[];
}

// ── Clients ───────────────────────────────────────────────────────────────────
export interface ClientGrowthPoint {
  label: string;
  new: number;
  returning: number;
  churned: number;
}

export interface TopClient {
  id: string;
  name: string;
  visits: number;
  spend: number;
}

export interface ClientsKPI {
  totalClients: number;
  newThisMonth: number;
  retentionRate: number;
  avgVisitsPerClient: number;
  changes: {
    totalClients: number;
    newThisMonth: number;
    retentionRate: number;
    avgVisitsPerClient: number;
  };
}

export interface ClientsReport {
  growth: ClientGrowthPoint[];
  topClients: TopClient[];
  kpi: ClientsKPI;
}

// ── Staff ─────────────────────────────────────────────────────────────────────
export interface StaffPerformance {
  id: string;
  name: string;
  bookings: number;
  revenue: number;
  rating: number;
  utilization: number;
  avgTicket: number;
  color?: string;
}

export interface StaffRadarPoint {
  metric: string;
  [staffName: string]: string | number;
}

export interface StaffKPI {
  activeStaff: number;
  avgUtilization: number;
  topEarnerRevenue: number;
  avgRating: number;
  changes: {
    activeStaff: number;
    avgUtilization: number;
    topEarnerRevenue: number;
    avgRating: number;
  };
}

export interface StaffReport {
  performance: StaffPerformance[];
  radar: StaffRadarPoint[];
  kpi: StaffKPI;
}

// ── Services ──────────────────────────────────────────────────────────────────
export interface ServicePerformance {
  id?: string;
  name: string;
  bookings: number;
  revenue: number;
  avgTicket: number;
  growth: number;
  color?: string;
}

export interface ServicesKPI {
  activeServices: number;
  topServiceRevenue: number;
  avgTicket: number;
  newServices: number;
  changes: {
    activeServices: number;
    topServiceRevenue: number;
    avgTicket: number;
    newServices: number;
  };
}

export interface ServicesReport {
  services: ServicePerformance[];
  kpi: ServicesKPI;
}

// ── Filters ───────────────────────────────────────────────────────────────────
export interface ReportFilters {
  period: ReportPeriod;
  from?: string;
  to?: string;
  salonId: string;
}
