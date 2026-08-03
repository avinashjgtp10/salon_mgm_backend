export interface DashboardSummary {
  totalRevenue: number;
  // True all-time total, unlike totalRevenue above which is scoped to the
  // current calendar month.
  allTimeRevenue: number;
  totalAppointments: number;
  totalClients: number;
  todayRevenue: number;
  revenueChange: number | null;
  appointmentsChange: number | null;
  clientsChange: number | null;
  todayRevenueChange: number | null;
  todayAppointmentsCount: number;
  // Total revenue this month / count of completed sales this month — 0 when
  // there are no completed sales yet, so the UI can show "—" instead of ₹0.
  avgBillValue: number;
  avgBillValueChange: number | null;
  // Raw comparison figures for the KPI flip cards (back face) — the front
  // face already has the "this period" value + % change; the back face shows
  // the actual prior-period number being compared against.
  lastMonthRevenue: number;
  yesterdayRevenue: number;
  newClientsToday: number;
  newClientsThisMonth: number;
}

export interface StaffRevenueEntry {
  id: string;
  name: string;
  role: string;
  revenue: number;
}

export interface TodayOverview {
  bookings: number;
  waiting: number;
  delayed: number;
  paymentDue: number;
  runningLate: number;
}

export interface TimelineSlot {
  hour: string;
  count: number;
}

export interface PendingPayments {
  count: number;
  amount: number;
}

export interface BirthdayClient {
  id: string;
  name: string;
}

export interface TodaysBirthdays {
  count: number;
  clients: BirthdayClient[];
}

export interface InactiveClients {
  count: number;
}

export interface ActivityItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
}

export interface TodayAppointment {
  id: string;
  clientName: string;
  service: string;
  staffName: string;
  time: string;
  status: "completed" | "upcoming" | "partial" | "cancelled" | "no-show" | "deleted";
  amount: number;
}

export interface RevenueDataPoint {
  // Short, period-appropriate X-axis tick — hour ("09:00 AM") for today,
  // weekday ("Tue") for weekly, bare day-of-month ("28") for monthly, month
  // ("Jul") for yearly. Never grouped into "Week 1/2/3/4" for monthly.
  month: string;
  // Full context for the tooltip — same as `month` for today (the hour IS
  // the full context there); "Tue, 28 Jul 2026" for weekly; "28 Jul 2026" for
  // monthly; "Jul 2026" for yearly.
  fullLabel: string;
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

export interface DashboardService {
  id: string;
  name: string;
  price: string;
  duration: number;
  category_name: string | null;
  price_type: "fixed" | "from" | "free" | null;
  is_active: boolean;
}

export interface DashboardAll {
  summary: DashboardSummary;
  todayAppointments: TodayAppointment[];
  revenueChart: RevenueDataPoint[];
  topStaff: TopStaffMember[];
  serviceMix: ServiceMixItem[];
  services: DashboardService[];
  todayOverview: TodayOverview;
  todayTimeline: TimelineSlot[];
  pendingPayments: PendingPayments;
  todaysBirthdays: TodaysBirthdays;
  inactiveClients: InactiveClients;
  recentActivity: ActivityItem[];
}
