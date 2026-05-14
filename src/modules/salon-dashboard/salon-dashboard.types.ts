export interface DashboardSummary {
  totalRevenue: number;
  totalAppointments: number;
  totalClients: number;
  todayRevenue: number;
  revenueChange: number | null;
  appointmentsChange: number | null;
  clientsChange: number | null;
  todayRevenueChange: number | null;
  todayAppointmentsCount: number;
}

export interface TodayAppointment {
  id: string;
  clientName: string;
  service: string;
  staffName: string;
  time: string;
  status: "completed" | "in-progress" | "upcoming" | "cancelled";
  amount: number;
}

export interface RevenueDataPoint {
  month: string;
  revenue: number;
  expenses: number;
}

export interface TopStaffMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  clientCount: number;
  revenue: number;
  bookings: number;
}

export interface ServiceMixItem {
  name: string;
  value: number;
}

export interface DashboardAll {
  summary: DashboardSummary;
  todayAppointments: TodayAppointment[];
  revenueChart: RevenueDataPoint[];
  topStaff: TopStaffMember[];
  serviceMix: ServiceMixItem[];
}
