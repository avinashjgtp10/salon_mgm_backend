export type ReportPeriod =
  | "today"
  | "7d"
  | "15d"
  | "30d"
  | "60d"
  | "90d"
  | "12m"
  | "custom";
export type ReportTab = "revenue" | "appointments" | "clients" | "staff" | "services";

// ── Revenue ───────────────────────────────────────────────────────────────────
export interface RevenueTrendPoint {
  label: string;
  revenue: number;
  target: number;
  prev: number;
}

export interface RevenueKPI {
  currentMonthRevenue: number;
  todayRevenue: number;
  yesterdayRevenue: number;
  avgDailyRevenue: number;
  totalTransactions: number;
  changes: {
    currentMonthRevenue: number;
    todayRevenue: number;
    avgDailyRevenue: number;
    totalTransactions: number;
  };
}

export interface RevenueServiceItem {
  name: string;
  bookings: number;
  revenue: number;
  avgTicket: number;
  growth: number;
  color: string;
}

export interface RevenueCardItem {
  label: string;
  value: string;
  change: string;
  up: boolean;
  color: string;
}

export interface RevenueReport {
  kpi: RevenueKPI;
  trend: RevenueTrendPoint[];
  services: RevenueServiceItem[];
  cards: RevenueCardItem[];
}

export interface RevenueReportQuery {
  period?: ReportPeriod | string;
  from?: string;
  to?: string;
}

export interface RevenueByServiceSummary {
  totalRevenue: number;
  totalBookings: number;
  totalServices: number;
  averageServiceValue: number;
}

export interface RevenueByServiceRow {
  serviceId: string;
  serviceName: string;
  category: string;
  bookingCount: number;
  revenue: number;
  avgValue: number;
  revenueShare: number;
}

export interface RevenueByServiceReport {
  summary: RevenueByServiceSummary;
  rows: RevenueByServiceRow[];
}

export interface RevenueByServiceDetailSummary {
  serviceName: string;
  category: string;
  bookingCount: number;
  totalRevenue: number;
  averageValue: number;
  revenuePercentage: number;
  topStaff: string;
  topClient: string;
}

export interface RevenueByServiceDetailRow {
  appointmentDate: string;
  clientName: string;
  staffName: string;
  duration: number;
  amount: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
}

export interface RevenueByServiceDetailReport {
  summary: RevenueByServiceDetailSummary;
  details: RevenueByServiceDetailRow[];
  appointments?: RevenueByServiceDetailRow[];
}

// ── Revenue by Category ───────────────────────────────────────────────────────
export interface RevenueByServiceCategorySummary {
  totalCategories: number;
  totalRevenue: number;
  totalBookings: number;
  topRevenueCategory: string;
  topCategory?: string;
}

export interface RevenueByServiceCategoryRow {
  categoryId: string;
  categoryName: string;
  servicesCount: number;
  serviceCount?: number;
  bookingCount: number;
  revenue: number;
  avgValue: number;
  avgRevenuePerBooking?: number;
  revenuePercentage: number;
}

export interface RevenueByServiceCategoryReport {
  summary: RevenueByServiceCategorySummary;
  tableData: RevenueByServiceCategoryRow[];
  rows?: RevenueByServiceCategoryRow[];
}

export interface ServiceRevenueInCategory {
  serviceId: string;
  serviceName: string;
  bookingCount: number;
  revenue: number;
  avgValue: number;
  categoryRevenuePercentage: number;
}

export interface RevenueByServiceCategoryDetailReport {
  categoryName: string;
  services: ServiceRevenueInCategory[];
}

// Employee Performance
export type EmployeePerformanceSortBy = "revenue" | "utilization" | "bookings";
export type EmployeePerformanceSortOrder = "asc" | "desc";

export interface EmployeePerformanceRow {
  employeeId: string;
  employeeName: string;
  role: string;
  department: string;
  totalBookings: number;
  completedAppointments: number;
  workingHours: number;
  appointmentHours: number;
  utilizationPercentage: number;
  totalRevenueGenerated: number;
}

export interface EmployeePerformanceSummary {
  totalEmployees: number;
  totalRevenue: number;
  totalBookings: number;
  averageUtilizationPercentage: number;
  topPerformingEmployee: {
    employeeId: string;
    employeeName: string;
    revenue: number;
  } | null;
}

export interface EmployeePerformancePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EmployeePerformanceReport {
  summary: EmployeePerformanceSummary;
  rows: EmployeePerformanceRow[];
  pagination: EmployeePerformancePagination;
}

export interface EmployeePerformanceQuery {
  from: string;
  to: string;
  employeeId?: string;
  role?: string;
  department?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
}

export type StaffRevenueAnalyticsViewType = "day" | "week" | "month" | "year";

export interface StaffRevenueAnalyticsRow {
  staffId: string;
  staffName: string;
  role: string;
  serviceRevenue: number;
  productRevenue: number;
  totalRevenue: number;
  avgDailyRevenue: number;
  growthPercentage: number;
}

export interface StaffRevenueAnalyticsSummary {
  totalStaffRevenue: number;
  totalServiceRevenue: number;
  totalProductRevenue: number;
  topPerformingStaff: {
    staffId: string;
    staffName: string;
    totalRevenue: number;
  } | null;
}

export interface StaffRevenueAnalyticsReport {
  summary: StaffRevenueAnalyticsSummary;
  rows: StaffRevenueAnalyticsRow[];
}

export interface StaffRevenueAnalyticsQuery {
  from: string;
  to: string;
  staffId?: string;
  role?: string;
  viewType?: string;
}

export type StaffProductSalesSortBy =
  | "highest_revenue"
  | "lowest_revenue"
  | "highest_quantity_sold"
  | "lowest_quantity_sold"
  | "highest_avg_product_value";

export interface StaffProductSalesRow {
  staffId: string;
  staffName: string;
  role: string;
  productsSoldQty: number;
  productRevenue: number;
  avgProductValue: number;
  topSellingProduct: string;
}

export interface StaffProductSalesSummary {
  totalProductRevenue: number;
  totalProductsSold: number;
  topProductSeller: string;
  topSellingProduct: string;
}

export interface StaffProductSalesReport {
  summary: StaffProductSalesSummary;
  tableData: StaffProductSalesRow[];
}

export interface StaffProductSalesQuery {
  from: string;
  to: string;
  staffId?: string;
  role?: string;
  productCategory?: string;
  productName?: string;
  search?: string;
  sortBy?: string;
}

export type StaffServiceSalesSortBy =
  | "highest_revenue"
  | "lowest_revenue"
  | "most_services_completed"
  | "least_services_completed"
  | "most_customers_served";

export interface StaffServiceSalesRow {
  staffId: string;
  staffName: string;
  role: string;
  servicesCompleted: number;
  serviceRevenue: number;
  customersServed: number;
  avgServiceValue: number;
  topService: string;
}

export interface StaffServiceSalesSummary {
  totalServiceRevenue: number;
  totalServicesCompleted: number;
  topPerformer: string;
  averageServiceValue: number;
}

export interface StaffServiceSalesReport {
  summary: StaffServiceSalesSummary;
  tableData: StaffServiceSalesRow[];
}

export interface StaffServiceSalesQuery {
  from: string;
  to: string;
  staffId?: string;
  role?: string;
  serviceCategory?: string;
  serviceName?: string;
  sortBy?: string;
}

// ── Appointments ──────────────────────────────────────────────────────────────
export type SalesDashboardTrendGroup = "daily" | "weekly" | "monthly" | "yearly";
export type SalesDashboardEmployeeSortBy =
  | "revenue"
  | "servicesSold"
  | "productRevenue"
  | "averageTicket";
export type SalesDashboardSortOrder = "asc" | "desc";
export type SalesDashboardSection =
  | "filters"
  | "kpiCards"
  | "revenueSources"
  | "paymentCollection"
  | "charts"
  | "employeeSalesTable"
  | "employeeDrillDowns";

export interface SalesDashboardQuery {
  from?: string;
  to?: string;
  employeeId?: string;
  employeeType?: string;
  activity?: string;
  branchId?: string;
  groupBy?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  pageSize?: number;
  sections?: string;
}

export interface SalesDashboardKpiCards {
  grossSales: number;
  serviceRevenue: number;
  productRevenue: number;
  packageRevenue: number;
  membershipRevenue: number;
  giftCardRevenue: number;
  totalTransactions: number;
  averageTicketValue: number;
}

export interface SalesDashboardRevenueSources {
  serviceRevenue: number;
  productRevenue: number;
  packageRevenue: number;
  membershipRevenue: number;
  giftCardRevenue: number;
  taxes: number;
  advanceAdded: number;
  totalRevenue: number;
}

export interface SalesDashboardPaymentMethod {
  paymentMethod: string;
  totalAmount: number;
  transactions: number;
}

export interface SalesDashboardSaleTypePoint {
  type: string;
  revenue: number;
}

export interface SalesDashboardStaffRevenuePoint {
  employeeId: string;
  employeeName: string;
  totalRevenue: number;
}

export interface SalesDashboardDistributionPoint {
  type: string;
  revenue: number;
  percentage: number;
}

export interface SalesDashboardTopService {
  serviceName: string;
  revenue: number;
  quantitySold: number;
}

export interface SalesDashboardTopProduct {
  productName: string;
  revenue: number;
  quantitySold: number;
}

export interface SalesDashboardTrendPoint {
  period: string;
  revenue: number;
}

export interface SalesDashboardEmployeeRow {
  employeeId: string;
  employeeName: string;
  role: string;
  bookings: number;
  servicesSold: number;
  productsSold: number;
  serviceRevenue: number;
  productRevenue: number;
  totalRevenue: number;
  averageTicket: number;
  customersServed: number;
}

export interface SalesDashboardEmployeeSummary {
  employeeId: string;
  employeeName: string;
  role: string;
  totalRevenue: number;
  serviceRevenue: number;
  productRevenue: number;
  bookings: number;
  customers: number;
  averageTicket: number;
}

export interface SalesDashboardEmployeeAppointmentDetail {
  appointmentDate: string;
  clientName: string;
  serviceName: string;
  amount: number;
  paymentMethod: string;
  status: string;
}

export interface SalesDashboardEmployeeServiceDetail {
  serviceName: string;
  quantity: number;
  revenue: number;
}

export interface SalesDashboardEmployeeProductDetail {
  productName: string;
  quantity: number;
  revenue: number;
}

export interface SalesDashboardEmployeeDrillDown {
  employeeSummary: SalesDashboardEmployeeSummary;
  appointmentDetails: SalesDashboardEmployeeAppointmentDetail[];
  servicesPerformed: SalesDashboardEmployeeServiceDetail[];
  productsSold: SalesDashboardEmployeeProductDetail[];
}

export interface SalesDashboardEmployeeTable {
  rows: SalesDashboardEmployeeRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  search: string;
  sortBy: SalesDashboardEmployeeSortBy;
  sortOrder: SalesDashboardSortOrder;
}

export interface SalesDashboardReport {
  filters: {
    from: string;
    to: string;
    employeeId?: string;
    employeeType?: string;
    activity?: string;
    branchId?: string;
    groupBy: SalesDashboardTrendGroup;
  };
  kpiCards: SalesDashboardKpiCards;
  revenueSources: SalesDashboardRevenueSources;
  paymentCollection: {
    totalAmount: number;
    methods: SalesDashboardPaymentMethod[];
  };
  charts: {
    revenueBySaleType: SalesDashboardSaleTypePoint[];
    staffRevenue: SalesDashboardStaffRevenuePoint[];
    revenueDistribution: SalesDashboardDistributionPoint[];
    topServices: SalesDashboardTopService[];
    topProducts: SalesDashboardTopProduct[];
    dailyRevenueTrend: SalesDashboardTrendPoint[];
  };
  employeeSalesTable: SalesDashboardEmployeeTable;
  employeeDrillDowns: Record<string, SalesDashboardEmployeeDrillDown>;
}

export interface SalesDashboardResponse {
  filters: SalesDashboardReport["filters"];
  requestedSections: SalesDashboardSection[];
  kpiCards?: SalesDashboardKpiCards;
  revenueSources?: SalesDashboardRevenueSources;
  paymentCollection?: SalesDashboardReport["paymentCollection"];
  charts?: SalesDashboardReport["charts"];
  employeeSalesTable?: SalesDashboardEmployeeTable;
  employeeDrillDowns?: Record<string, SalesDashboardEmployeeDrillDown>;
}

export interface AppointmentVolumePoint {
  label: string;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface AppointmentSummary {
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  cancellationRate: number;
  noShowRate: number;
}

export interface AppointmentPeakHour {
  hour: string;
  count: number;
}

export interface AppointmentBookingSource {
  source: string;
  count: number;
}

export interface AppointmentTrendPoint {
  period: string;
  appointments: number;
}

export interface TopAppointmentService {
  serviceName: string;
  bookingCount: number;
}

export interface AppointmentTableRow {
  appointmentDate: string;
  appointmentTime: string;
  bookedDate: string;
  clientName: string;
  serviceName: string;
  staffName: string;
  status: string;
  duration: number;
  amount: number;
  paymentMethod: string;
  paymentStatus: string;
}

export interface AppointmentAnalyticsQuery {
  period?: ReportPeriod | string;
  from?: string;
  to?: string;
  staffId?: string;
  serviceId?: string;
  branchId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface AppointmentsReport {
  summary: AppointmentSummary;
  appointmentVolume: AppointmentVolumePoint[];
  peakHours: AppointmentPeakHour[];
  bookingSources: AppointmentBookingSource[];
  appointmentTrend: AppointmentTrendPoint[];
  topServices: TopAppointmentService[];
  tableData: AppointmentTableRow[];
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
