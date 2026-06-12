import type { EntityId } from "./common.types";

// ── Period & Tab ───────────────────────────────────────────────────────────────
export type ReportPeriod = "7d" | "30d" | "90d" | "12m";
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

export interface PeakHourPoint {
  hour: string;
  count: number;
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
  peakHours: PeakHourPoint[];
  kpi: AppointmentsKPI;
}

// ── Clients ───────────────────────────────────────────────────────────────────
export interface ClientGrowthPoint {
  label: string;
  new: number;
  returning: number;
  churned: number;
}

export interface TopClient {
  id: EntityId;
  name: string;
  visits: number;
  spend: number;
  avatar?: string;
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
  id: EntityId;
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
  id?: EntityId;
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

// ── Reports Dashboard (GET /api/v1/reports) ───────────────────────────────────

export interface ReportFilterOption {
  value: string;
  label: string;
}

export interface ReportFilter {
  key: string;
  type: "date-single" | "date-range" | "multi-select" | "dropdown";
  label: string;
  fromKey?: string;
  toKey?: string;
  options?: ReportFilterOption[];
}

export interface ReportTableColumn {
  key: string;
  label: string;
  type: "text" | "date" | "time" | "number" | "currency" | "badge" | "link";
  sortable?: boolean;
}

export interface ReportTableConfig {
  columns: ReportTableColumn[];
  rowsPerPage?: number[];
  rowGrouping?: boolean;
}

export interface ReportPermissions {
  view: boolean;
  export: boolean;
  saveView: boolean;
  refresh: boolean;
}

export interface ReportPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DashboardReport {
  id: string;
  name: string;
  description: string;
  tags: string[];
  isNewVersion: boolean;
  isBookmarked: boolean;
  category: string;
  permissions?: ReportPermissions;
  filters?: ReportFilter[];
  tableConfig?: ReportTableConfig;
  data?: Record<string, unknown>[];
  pagination?: ReportPagination;
}

export interface DashboardCategory {
  key: string;
  label: string;
  count: number;
}

export interface ReportsDashboard {
  title: string;
  search: { placeholder: string };
  categories: DashboardCategory[];
  bookmarked: {
    title: string;
    emptyTitle: string;
    emptySubtitle: string;
    items: DashboardReport[];
  };
  reports: DashboardReport[];
}

export interface ReportsDashboardResponse {
  success: boolean;
  message: string;
  timestamp: string;
  reportsDashboard: ReportsDashboard;
}

export interface FetchReportsDashboardPayload {
  search?: string;
  category?: string;
}

// ── Query payload ─────────────────────────────────────────────────────────────
export interface FetchReportPayload {
  tab: ReportTab;
  period: ReportPeriod;
  from?: string;
  to?: string;
}

export interface ExportReportPayload {
  tab: ReportTab;
  period: ReportPeriod;
  format: "excel" | "csv";
}

// ── API responses ─────────────────────────────────────────────────────────────
export interface RevenueReportResponse {
  data: RevenueReport;
}

export interface AppointmentsReportResponse {
  data: AppointmentsReport;
}

export interface ClientsReportResponse {
  data: ClientsReport;
}

export interface StaffReportResponse {
  data: StaffReport;
}

export interface ServicesReportResponse {
  data: ServicesReport;
}