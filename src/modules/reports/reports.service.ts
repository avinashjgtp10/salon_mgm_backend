import { AppError } from "../../middleware/error.middleware";
import { reportsRepository } from "./reports.repository";
import type { ReportPeriod, ReportTab } from "./reports.types";

const VALID_PERIODS: ReportPeriod[] = ["7d", "30d", "90d", "12m", "custom"];
const VALID_TABS:    ReportTab[]    = ["revenue", "appointments", "clients", "staff", "services"];

function assertSalonId(salonId: string) {
  if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
}

function assertPeriod(period: string, from?: string, to?: string): ReportPeriod {
  if (period === "custom" && from && to) return "custom";
  if (!VALID_PERIODS.includes(period as ReportPeriod))
    throw new AppError(400, `period must be one of: ${VALID_PERIODS.join(", ")}`, "VALIDATION_ERROR");
  return period as ReportPeriod;
}

// ── Static reports dashboard configuration ────────────────────────────────────
const DASHBOARD_CATEGORIES = [
  { key: "all",          label: "All",           count: 32 },
  { key: "daily_reports",label: "Daily Reports", count: 1  },
  { key: "employee",     label: "Employee",      count: 21 },
  { key: "finance",      label: "Finance",       count: 2  },
  { key: "inventory",    label: "Inventory",     count: 2  },
  { key: "marketing",    label: "Marketing",     count: 2  },
  { key: "operational",  label: "Operational",   count: 2  },
  { key: "payments",     label: "Payments",      count: 2  },
];

const EMPTY_PAGINATION = { page: 1, limit: 10, total: 0, totalPages: 0 };

const ALL_REPORT_CONFIGS = [
  // ── Operational ────────────────────────────────────────────────────────────
  {
    id: "appointments", name: "Appointments", category: "operational",
    isNewVersion: true, isBookmarked: false, tags: ["Operational", "Appointments"],
    description: "Use this report to view the details of all the appointments (including no-shows and cancelled appointments).",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date_type", type: "dropdown", label: "Date Type", options: [
        { value: "appointment_date", label: "Appointment Date" },
        { value: "booked_date",      label: "Booked Date" },
        { value: "updated_date",     label: "Updated Date" },
      ]},
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
      { key: "appointment_status", type: "multi-select", label: "Appointment Status", options: [
        { value: "confirmed", label: "Confirmed" }, { value: "completed", label: "Completed" },
        { value: "cancelled", label: "Cancelled" }, { value: "no_show",   label: "No Show" },
        { value: "pending",   label: "Pending" },   { value: "walk_in",   label: "Walk-in" },
      ]},
      { key: "appointment_source", type: "multi-select", label: "Appointment Source", options: [
        { value: "online",    label: "Online" },   { value: "walk_in",  label: "Walk-in" },
        { value: "phone",     label: "Phone" },    { value: "app",      label: "App" },
        { value: "instagram", label: "Instagram" },{ value: "whatsapp", label: "WhatsApp" },
        { value: "referral",  label: "Referral" }, { value: "other",    label: "Other" },
      ]},
    ],
    tableConfig: {
      rowGrouping: true, rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "appointment_date", label: "Appointment Date", type: "date",   sortable: true },
        { key: "booked_date",      label: "Booked Date",      type: "date",   sortable: true },
        { key: "ticket_no",        label: "Ticket No",        type: "link",   sortable: true },
        { key: "guest_name",       label: "Guest Name",       type: "text",   sortable: true },
        { key: "service_name",     label: "Service Name",     type: "text",   sortable: true },
        { key: "staff_name",       label: "Staff Name",       type: "text",   sortable: true },
        { key: "status",           label: "Status",           type: "badge",  sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  {
    id: "client_retention", name: "Client Retention", category: "operational",
    isNewVersion: true, isBookmarked: false, tags: ["Operational"],
    description: "Identify clients who haven't visited in the last 30, 60, or 90 days to drive re-engagement.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Last Visit Date", fromKey: "date_from", toKey: "date_to" },
      { key: "inactive_days", type: "dropdown", label: "Inactive Since", options: [
        { value: "30", label: "30 Days" }, { value: "60", label: "60 Days" },
        { value: "90", label: "90 Days" }, { value: "180", label: "180 Days" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "clientName",     label: "Guest Name",       type: "text",     sortable: true },
        { key: "phone",          label: "Phone",            type: "text",     sortable: true },
        { key: "lastVisitDate",  label: "Last Visit Date",  type: "date",     sortable: true },
        { key: "totalVisits",    label: "Total Visits",     type: "number",   sortable: true },
        { key: "totalSpent",     label: "Total Spent",      type: "currency", sortable: true },
        { key: "daysSinceVisit", label: "Days Since Visit", type: "number",   sortable: true },
        { key: "centerName",     label: "Center",           type: "text",     sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    id: "collections", name: "Collections", category: "finance",
    isNewVersion: true, isBookmarked: false, tags: ["Finance", "Collections"],
    description: "Use this report to view the payments received (including redemptions) on a day or during the given period.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
      { key: "payment_method", type: "multi-select", label: "Payment Method", options: [
        { value: "cash", label: "Cash" }, { value: "card", label: "Card" },
        { value: "upi",  label: "UPI" },  { value: "wallet", label: "Wallet" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "date",          label: "Date",           type: "date",     sortable: true },
        { key: "ticketNo",      label: "Ticket No",      type: "link",     sortable: true },
        { key: "clientName",    label: "Guest Name",     type: "text",     sortable: true },
        { key: "service",       label: "Service",        type: "text",     sortable: false },
        { key: "paymentMethod", label: "Payment Method", type: "badge",    sortable: true },
        { key: "amount",        label: "Amount",         type: "currency", sortable: true },
        { key: "staff",         label: "Staff",          type: "text",     sortable: true },
        { key: "center",        label: "Center",         type: "text",     sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  {
    id: "revenue_by_service", name: "Revenue by Service", category: "finance",
    isNewVersion: false, isBookmarked: false, tags: ["Finance", "Operational"],
    description: "Break down total revenue by individual services offered, with average ticket and booking counts.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "name",      label: "Service Name", type: "text",     sortable: true },
        { key: "bookings",  label: "Bookings",     type: "number",   sortable: true },
        { key: "revenue",   label: "Revenue",      type: "currency", sortable: true },
        { key: "avgTicket", label: "Avg Ticket",   type: "currency", sortable: true },
        { key: "growth",    label: "Growth %",     type: "number",   sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Inventory ──────────────────────────────────────────────────────────────
  {
    id: "current_stock", name: "Current Stock", category: "inventory",
    isNewVersion: true, isBookmarked: false, tags: ["Inventory", "Value"],
    description: "Use this report to know the on-hand stock and the cost of goods based on the FIFO or perpetual average costing method.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "category", type: "multi-select", label: "Product Category", options: [
        { value: "hair_care", label: "Hair Care" }, { value: "hair_color", label: "Hair Color" },
        { value: "nails",     label: "Nails" },      { value: "skin_care",  label: "Skin Care" },
      ]},
      { key: "stock_status", type: "dropdown", label: "Stock Status", options: [
        { value: "All", label: "All" }, { value: "In Stock", label: "In Stock" },
        { value: "Low Stock", label: "Low Stock" }, { value: "Out of Stock", label: "Out of Stock" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "product",      label: "Product",       type: "text",     sortable: true },
        { key: "category",     label: "Category",      type: "text",     sortable: true },
        { key: "sku",          label: "SKU",           type: "text",     sortable: true },
        { key: "currentStock", label: "Current Stock", type: "number",   sortable: true },
        { key: "reorderLevel", label: "Reorder Level", type: "number",   sortable: true },
        { key: "unitCost",     label: "Unit Cost (₹)", type: "currency", sortable: true },
        { key: "totalValue",   label: "Total Value (₹)",type:"currency", sortable: true },
        { key: "status",       label: "Status",        type: "badge",    sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  {
    id: "inventory_consumption", name: "Inventory Consumption", category: "inventory",
    isNewVersion: false, isBookmarked: false, tags: ["Inventory"],
    description: "Track the quantity of products consumed in services versus sold directly to clients.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
      { key: "type", type: "dropdown", label: "Consumption Type", options: [
        { value: "All", label: "All" }, { value: "Service Use", label: "Service Use" },
        { value: "Retail Sale", label: "Retail Sale" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "date",        label: "Date",         type: "date",     sortable: true },
        { key: "product",     label: "Product Name", type: "text",     sortable: true },
        { key: "type",        label: "Type",         type: "badge",    sortable: true },
        { key: "qtyConsumed", label: "Qty Consumed", type: "number",   sortable: true },
        { key: "unitCost",    label: "Unit Cost",    type: "currency", sortable: true },
        { key: "totalCost",   label: "Total Cost",   type: "currency", sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Payments ───────────────────────────────────────────────────────────────
  {
    id: "digital_payments", name: "Digital Payments", category: "payments",
    isNewVersion: true, isBookmarked: false, tags: ["Payments"],
    description: "Use this report to list all the payments collected via online payment provider integrated with your salon.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
      { key: "provider", type: "multi-select", label: "Provider", options: [
        { value: "razorpay", label: "Razorpay" }, { value: "paytm",    label: "Paytm" },
        { value: "stripe",   label: "Stripe" },   { value: "payu",     label: "PayU" },
      ]},
      { key: "status", type: "dropdown", label: "Status", options: [
        { value: "All", label: "All" }, { value: "Success", label: "Success" },
        { value: "Pending", label: "Pending" }, { value: "Failed", label: "Failed" },
        { value: "Refunded", label: "Refunded" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "date",          label: "Date",           type: "date",     sortable: true },
        { key: "transactionId", label: "Transaction ID", type: "link",     sortable: true },
        { key: "clientName",    label: "Guest Name",     type: "text",     sortable: true },
        { key: "gateway",       label: "Provider",       type: "badge",    sortable: true },
        { key: "amount",        label: "Amount",         type: "currency", sortable: true },
        { key: "status",        label: "Status",         type: "badge",    sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  {
    id: "payment_summary", name: "Payment Summary", category: "payments",
    isNewVersion: false, isBookmarked: false, tags: ["Payments"],
    description: "View a consolidated summary of all payment methods collected across all centers for a given period.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "paymentMethod", label: "Payment Method", type: "text",     sortable: true },
        { key: "transactions",  label: "Transactions",   type: "number",   sortable: true },
        { key: "totalAmount",   label: "Total Amount",   type: "currency", sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Daily Reports ──────────────────────────────────────────────────────────
  {
    id: "daily_summary", name: "Daily Summary", category: "daily_reports",
    isNewVersion: false, isBookmarked: false, tags: ["Daily Reports"],
    description: "View a complete daily summary of appointments, collections, and staff performance for any given date.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-single", label: "Date" },
    ],
    tableConfig: {
      columns: [
        { key: "time",          label: "Time",           type: "time",     sortable: true },
        { key: "ticketNo",      label: "Ticket No",      type: "link",     sortable: true },
        { key: "clientName",    label: "Client Name",    type: "text",     sortable: true },
        { key: "service",       label: "Service",        type: "text",     sortable: false },
        { key: "staff",         label: "Staff",          type: "text",     sortable: true },
        { key: "amount",        label: "Amount (₹)",     type: "currency", sortable: true },
        { key: "paymentMethod", label: "Payment Method", type: "badge",    sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Marketing ──────────────────────────────────────────────────────────────
  {
    id: "campaign_performance", name: "Campaign Performance", category: "marketing",
    isNewVersion: false, isBookmarked: false, tags: ["Marketing"],
    description: "Measure the effectiveness of marketing campaigns by tracking reach, conversions, and revenue generated.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "clientName",  label: "Client Name",   type: "text",     sortable: true },
        { key: "phone",       label: "Phone",         type: "text",     sortable: true },
        { key: "status",      label: "Status",        type: "badge",    sortable: true },
        { key: "lastVisit",   label: "Last Activity", type: "date",     sortable: true },
        { key: "spend",       label: "Total Sales",   type: "currency", sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  {
    id: "client_acquisition", name: "Client Acquisition", category: "marketing",
    isNewVersion: false, isBookmarked: false, tags: ["Marketing"],
    description: "Analyse how new clients are acquired across different channels and referral sources over a period.",
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "clientName", label: "Client Name", type: "text", sortable: true },
        { key: "phone",      label: "Phone",       type: "text", sortable: true },
        { key: "email",      label: "Email",       type: "text", sortable: true },
        { key: "lastVisit",  label: "First Visit", type: "date", sortable: true },
        { key: "spend",      label: "Spend",       type: "currency", sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Employee (21 reports) ──────────────────────────────────────────────────
  ...[
    { id: "attrition",                      name: "Attrition",                         tags: ["Team"],        description: "Track the number of center employees who have either joined or left the organization." },
    { id: "block_out_time_details",         name: "Block Out Time Details",            tags: ["Time"],        description: "Show times when providers are on break or unavailable using Block Out Time Types." },
    { id: "booking_productivity",           name: "Booking Productivity",              tags: ["Sales"],       description: "Insight into the types of services requested by your guests." },
    { id: "commissions",                    name: "Commissions",                       tags: ["Commissions"], description: "Calculate and review commission earned by each employee based on services and products sold." },
    { id: "commissions_graphical",          name: "Commissions - Graphical",           tags: ["Commissions"], description: "Graphical breakdown of commission earned per employee." },
    { id: "employee_collections",           name: "Employee Collections",              tags: ["Sales"],       description: "View the collections made by each employee during a selected period." },
    { id: "employee_collections_by_item",   name: "Employee Collections By Item Type", tags: ["Sales"],      description: "View details of the sales for each item type: services, products, memberships." },
    { id: "employee_sales_metrics",         name: "Employee Sales Metrics",            tags: ["Performance"], description: "Track all sales employees make in a selected time period." },
    { id: "guest_satisfaction",             name: "Guest Satisfaction",                tags: ["Performance"], description: "Evaluate client satisfaction scores across employees and services." },
    { id: "leaves",                         name: "Leaves",                            tags: ["Time"],        description: "Track the number of leaves availed by employees of each leave type as well as the status." },
    { id: "no_show_cancellation",           name: "No-show/Cancellation",              tags: ["Sales"],       description: "View a quick snapshot of guests who either did not come in for their appointments." },
    { id: "overtime",                       name: "Overtime",                          tags: ["Time"],        description: "Track overtime hours worked by each employee." },
    { id: "overtime_summary",               name: "Overtime Summary",                  tags: ["Time"],        description: "Track the number of extra hours spent by your center." },
    { id: "rebooking",                      name: "Rebooking",                         tags: ["Sales"],       description: "Track rebooking rates and patterns for clients and employees." },
    { id: "sales",                          name: "Sales",                             tags: ["Sales"],       description: "Detailed breakdown of all sales transactions by employee." },
    { id: "service_revenue_by_category",    name: "Service Revenue By Category",       tags: ["Sales"],       description: "View service revenue broken down by category." },
    { id: "split_commission",               name: "Split Commission",                  tags: ["Sales"],       description: "Track split commissions across employees for shared services." },
    { id: "staffing",                       name: "Staffing",                          tags: ["Team"],        description: "Track the total number of employees currently working in a center, categorized by role." },
    { id: "tip_adjustments",               name: "Tip Adjustments",                   tags: ["Sales"],       description: "View the trail of changes made to tips." },
    { id: "utilization",                    name: "Utilization",                       tags: ["Performance"], description: "Track how effectively employees' working hours are being utilized." },
    { id: "employee_performance",           name: "Employee Performance",              tags: ["Performance"], description: "Track individual employee revenue, bookings, and utilization rate." },
  ].map(r => ({
    ...r,
    category: "employee",
    isNewVersion: false,
    isBookmarked: false,
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
      { key: "employee", type: "multi-select", label: "Employee", options: [] },
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "name",             label: "Employee Name",    type: "text",     sortable: true },
        { key: "role",             label: "Role",             type: "text",     sortable: true },
        { key: "servicesPerformed",label: "Services",         type: "number",   sortable: true },
        { key: "revenue",          label: "Revenue",          type: "currency", sortable: true },
        { key: "avgTicket",        label: "Avg Ticket",       type: "currency", sortable: true },
        { key: "rating",           label: "Rating",           type: "number",   sortable: true },
        { key: "utilization",      label: "Utilization %",    type: "number",   sortable: true },
      ],
    },
    data: [],
    pagination: EMPTY_PAGINATION,
  })),
];

export const reportsService = {

  // ── Reports Dashboard ────────────────────────────────────────────────────────
  async getReportsDashboard(salonId: string, search: string, category: string) {
    assertSalonId(salonId);
    let reports: any[] = ALL_REPORT_CONFIGS;
    if (category && category !== "all") {
      reports = reports.filter(r => r.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      reports = reports.filter(
        r => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
      );
    }
    return {
      title:  "Reports Dashboard",
      search: { placeholder: "Search Report" },
      categories: DASHBOARD_CATEGORIES,
      bookmarked: {
        title:        "Bookmarked",
        emptyTitle:   "No bookmarked reports",
        emptySubtitle:"Start bookmarking reports to see bookmarked list of reports",
        items: [],
      },
      reports,
    };
  },

  // ── Analytics tabs ───────────────────────────────────────────────────────────
  async getRevenue(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getRevenue(salonId, assertPeriod(period, from, to), from, to);
  },

  async getAppointments(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getAppointments(salonId, assertPeriod(period, from, to), from, to);
  },

  async getClients(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getClients(salonId, assertPeriod(period, from, to), from, to);
  },

  async getStaff(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getStaff(salonId, assertPeriod(period, from, to), from, to);
  },

  async getServices(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getServices(salonId, assertPeriod(period, from, to), from, to);
  },

  async exportReport(
    salonId: string, tab: string, period: string, format: string,
    from?: string, to?: string,
  ) {
    assertSalonId(salonId);
    if (!VALID_TABS.includes(tab as ReportTab))
      throw new AppError(400, `tab must be one of: ${VALID_TABS.join(", ")}`, "VALIDATION_ERROR");
    if (!["excel", "csv"].includes(format))
      throw new AppError(400, "format must be excel or csv", "VALIDATION_ERROR");
    return reportsRepository.getExportData(salonId, tab, assertPeriod(period, from, to), from, to);
  },

  // ── Detail views — original ──────────────────────────────────────────────────
  async getAppointmentsDetail(
    salonId: string, dateType: string, from: string, to: string,
    statuses: string[], sources: string[] = [],
  ) {
    assertSalonId(salonId);
    return reportsRepository.getAppointmentsDetail(salonId, dateType, from, to, statuses, sources);
  },

  async getFinanceDetail(salonId: string, from: string, to: string, method: string) {
    assertSalonId(salonId);
    return reportsRepository.getFinanceDetail(salonId, from, to, method);
  },

  async getInventoryDetail(salonId: string, category: string, status: string) {
    assertSalonId(salonId);
    return reportsRepository.getInventoryDetail(salonId, category, status);
  },

  async getPaymentsDetail(
    salonId: string, from: string, to: string, gateway: string, status: string,
  ) {
    assertSalonId(salonId);
    return reportsRepository.getPaymentsDetail(salonId, from, to, gateway, status);
  },

  async getDailyDetail(salonId: string, date: string, service: string, staff: string) {
    assertSalonId(salonId);
    return reportsRepository.getDailyDetail(salonId, date, service, staff);
  },

  async getMarketingDetail(
    salonId: string, from: string, to: string, status: string, search: string,
  ) {
    assertSalonId(salonId);
    return reportsRepository.getMarketingDetail(salonId, from, to, status, search);
  },

  async getEmployeeDetail(salonId: string, from: string, to: string, role: string, department: string) {
    assertSalonId(salonId);
    return reportsRepository.getEmployeeDetail(salonId, from, to, role, department);
  },

  // ── Detail views — new ───────────────────────────────────────────────────────
  async getClientRetentionDetail(salonId: string, inactiveDays: number, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getClientRetentionDetail(salonId, inactiveDays, from, to);
  },

  async getInventoryConsumptionDetail(salonId: string, from: string, to: string, type: string) {
    assertSalonId(salonId);
    return reportsRepository.getInventoryConsumptionDetail(salonId, from, to, type);
  },

  async getPaymentSummaryDetail(salonId: string, from: string, to: string) {
    assertSalonId(salonId);
    return reportsRepository.getPaymentSummaryDetail(salonId, from, to);
  },

  async getCommissionsDetail(salonId: string, from: string, to: string) {
    assertSalonId(salonId);
    return reportsRepository.getCommissionsDetail(salonId, from, to);
  },

  async getNoShowCancellationDetail(salonId: string, from: string, to: string) {
    assertSalonId(salonId);
    return reportsRepository.getNoShowCancellationDetail(salonId, from, to);
  },

  async getStaffingDetail(salonId: string) {
    assertSalonId(salonId);
    return reportsRepository.getStaffingDetail(salonId);
  },

  async getLeavesDetail(salonId: string, from: string, to: string) {
    assertSalonId(salonId);
    return reportsRepository.getLeavesDetail(salonId, from, to);
  },
};