import type { Appointment } from "../appointments/appointments.types";

export interface DashboardSummary {
  totalRevenue: number;
  // True all-time total, unlike totalRevenue above which is scoped to the
  // current calendar month. Not read by the salon dashboard page itself, but
  // branch-owner.service.ts's multi-branch Finance Overview (BranchOwnerFinancePage's
  // "All-Time Revenue" stat) reads this off the same getSummary() call.
  allTimeRevenue: number;
  todayRevenue: number;
  revenueChange: number | null;
  todayRevenueChange: number | null;
  todayAppointmentsCount: number;
  yesterdayAppointmentsCount: number;
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

export interface PendingPayments {
  count: number;
  amount: number;
}

export interface BirthdayClient {
  id: string;
  name: string;
  phone: string | null;
  phoneCountryCode: string | null;
}

export interface TodaysBirthdays {
  clients: BirthdayClient[];
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
}

// Replaces the old appointment-status "Today's Summary" bar chart — payment
// mode breakdown (Cash/UPI/Card/…) with its own Today/Yesterday/Week toggle,
// independent of the Revenue Overview chart's period.
export interface PaymentModeBreakdownEntry {
  // Raw lowercase payment_method key ('cash', 'upi', 'card', …) — the
  // frontend formats it via utils/paymentMode.ts's formatPaymentMode() for
  // display, same as every other screen that shows a payment method.
  method: string;
  amount: number;
  percentage: number;
}

export interface PaymentModeBreakdown {
  entries: PaymentModeBreakdownEntry[];
  total: number;
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

export interface DashboardCombined {
  summary: DashboardSummary;
  // Raw enriched appointment rows for the requested day (same shape as
  // GET /api/v1/appointments, straight from appointmentsService.list) — the
  // frontend's existing mapApiBooking() normalizes these, so this endpoint
  // doesn't duplicate that tax/grand-total logic server-side a second time.
  todayAppointments: Appointment[];
  revenueChart: RevenueDataPoint[];
  pendingPayments: PendingPayments;
  todaysBirthdays: TodaysBirthdays;
  paymentModeBreakdown: PaymentModeBreakdown;
}
