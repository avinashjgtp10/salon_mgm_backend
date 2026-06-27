import { AppError } from "../../middleware/error.middleware";
import { normalizeEmployeePerformanceQuery } from "./reports.employee.helpers";
import { reportsRepository } from "./reports.repository";
import { normalizeRevenuePeriod, resolveRevenueDateRange } from "./reports.revenue.helpers";
import type {
  AppointmentAnalyticsQuery,
  EmployeePerformanceQuery,
  ReportPeriod,
  ReportTab,
  SalesDashboardEmployeeSortBy,
  SalesDashboardQuery,
  SalesDashboardResponse,
  SalesDashboardSection,
  SalesDashboardSortOrder,
  SalesDashboardTrendGroup,
  StaffProductSalesQuery,
  StaffProductSalesSortBy,
  StaffServiceSalesQuery,
  StaffServiceSalesSortBy,
  StaffRevenueAnalyticsQuery,
  StaffRevenueAnalyticsViewType,
} from "./reports.types";

const VALID_PERIODS: ReportPeriod[] = ["today", "7d", "15d", "30d", "60d", "90d", "12m", "custom"];
const VALID_TABS:    ReportTab[]    = ["revenue", "appointments", "clients", "staff", "services"];
const VALID_STAFF_REVENUE_VIEW_TYPES: StaffRevenueAnalyticsViewType[] = ["day", "week", "month", "year"];
const VALID_STAFF_PRODUCT_SALES_SORTS: StaffProductSalesSortBy[] = [
  "highest_revenue",
  "lowest_revenue",
  "highest_quantity_sold",
  "lowest_quantity_sold",
  "highest_avg_product_value",
];
const VALID_STAFF_SERVICE_SALES_SORTS: StaffServiceSalesSortBy[] = [
  "highest_revenue",
  "lowest_revenue",
  "most_services_completed",
  "least_services_completed",
  "most_customers_served",
];
const VALID_SALES_DASHBOARD_GROUPS: SalesDashboardTrendGroup[] = ["daily", "weekly", "monthly", "yearly"];
const VALID_SALES_DASHBOARD_SORTS: SalesDashboardEmployeeSortBy[] = [
  "revenue",
  "servicesSold",
  "productRevenue",
  "averageTicket",
];
const VALID_SALES_DASHBOARD_SORT_ORDERS: SalesDashboardSortOrder[] = ["asc", "desc"];
const VALID_SALES_DASHBOARD_SECTIONS: SalesDashboardSection[] = [
  "filters",
  "kpiCards",
  "revenueSources",
  "paymentCollection",
  "charts",
  "employeeSalesTable",
  "employeeDrillDowns",
];

function assertSalonId(salonId: string) {
  if (!salonId) throw new AppError(400, "salon_id is required", "VALIDATION_ERROR");
}

function assertPeriod(period: string, from?: string, to?: string): ReportPeriod {
  if (from || to) {
    resolveRevenueDateRange(period, from, to);
    return "custom";
  }

  const normalized = normalizeRevenuePeriod(period);

  if (normalized === "custom") {
    throw new AppError(400, "custom period requires both from and to", "VALIDATION_ERROR");
  }

  if (!VALID_PERIODS.includes(normalized))
    throw new AppError(400, `period must be one of: ${VALID_PERIODS.join(", ")}`, "VALIDATION_ERROR");

  return normalized;
}

function normalizeStaffRevenueAnalyticsQuery(query: StaffRevenueAnalyticsQuery) {
  const from = String(query.from ?? "").trim();
  const to = String(query.to ?? "").trim();
  const staffId = String(query.staffId ?? "").trim() || undefined;
  const role = String(query.role ?? "").trim() || undefined;
  const viewType = String(query.viewType ?? "day").trim().toLowerCase() as StaffRevenueAnalyticsViewType;

  if (!from || !to) {
    throw new AppError(400, "from and to are required", "VALIDATION_ERROR");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError(400, "from and to must be valid dates in YYYY-MM-DD format", "VALIDATION_ERROR");
  }

  if (new Date(`${from}T00:00:00Z`).getTime() > new Date(`${to}T00:00:00Z`).getTime()) {
    throw new AppError(400, "from cannot be greater than to", "VALIDATION_ERROR");
  }

  if (!VALID_STAFF_REVENUE_VIEW_TYPES.includes(viewType)) {
    throw new AppError(400, `viewType must be one of: ${VALID_STAFF_REVENUE_VIEW_TYPES.join(", ")}`, "VALIDATION_ERROR");
  }

  return { from, to, staffId, role, viewType };
}

function normalizeStaffProductSalesQuery(query: StaffProductSalesQuery) {
  const from = String(query.from ?? "").trim();
  const to = String(query.to ?? "").trim();
  const staffId = String(query.staffId ?? "").trim() || undefined;
  const role = String(query.role ?? "").trim() || undefined;
  const productCategory = String(query.productCategory ?? "").trim() || undefined;
  const productName = String(query.productName ?? "").trim() || undefined;
  const search = String(query.search ?? "").trim() || undefined;
  const sortBy = String(query.sortBy ?? "highest_revenue").trim().toLowerCase() as StaffProductSalesSortBy;

  if (!from || !to) {
    throw new AppError(400, "from and to are required", "VALIDATION_ERROR");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError(400, "from and to must be valid dates in YYYY-MM-DD format", "VALIDATION_ERROR");
  }

  if (new Date(`${from}T00:00:00Z`).getTime() > new Date(`${to}T00:00:00Z`).getTime()) {
    throw new AppError(400, "from cannot be greater than to", "VALIDATION_ERROR");
  }

  if (!VALID_STAFF_PRODUCT_SALES_SORTS.includes(sortBy)) {
    throw new AppError(400, `sortBy must be one of: ${VALID_STAFF_PRODUCT_SALES_SORTS.join(", ")}`, "VALIDATION_ERROR");
  }

  return { from, to, staffId, role, productCategory, productName, search, sortBy };
}

function normalizeStaffServiceSalesQuery(query: StaffServiceSalesQuery) {
  const from = String(query.from ?? "").trim();
  const to = String(query.to ?? "").trim();
  const staffId = String(query.staffId ?? "").trim() || undefined;
  const role = String(query.role ?? "").trim() || undefined;
  const serviceCategory = String(query.serviceCategory ?? "").trim() || undefined;
  const serviceName = String(query.serviceName ?? "").trim() || undefined;
  const sortBy = String(query.sortBy ?? "highest_revenue").trim().toLowerCase() as StaffServiceSalesSortBy;

  if (!from || !to) {
    throw new AppError(400, "from and to are required", "VALIDATION_ERROR");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError(400, "from and to must be valid dates in YYYY-MM-DD format", "VALIDATION_ERROR");
  }

  if (new Date(`${from}T00:00:00Z`).getTime() > new Date(`${to}T00:00:00Z`).getTime()) {
    throw new AppError(400, "from cannot be greater than to", "VALIDATION_ERROR");
  }

  if (!VALID_STAFF_SERVICE_SALES_SORTS.includes(sortBy)) {
    throw new AppError(400, `sortBy must be one of: ${VALID_STAFF_SERVICE_SALES_SORTS.join(", ")}`, "VALIDATION_ERROR");
  }

  return { from, to, staffId, role, serviceCategory, serviceName, sortBy };
}

function normalizeAppointmentAnalyticsQuery(query: AppointmentAnalyticsQuery) {
  const period = String(query.period ?? "30d").trim();
  const from = String(query.from ?? "").trim() || undefined;
  const to = String(query.to ?? "").trim() || undefined;
  const staffId = String(query.staffId ?? "").trim() || undefined;
  const serviceId = String(query.serviceId ?? "").trim() || undefined;
  const branchId = String(query.branchId ?? "").trim() || undefined;
  const search = String(query.search ?? "").trim() || undefined;
  const sortBy = String(query.sortBy ?? "appointmentDate").trim();
  const sortOrder = String(query.sortOrder ?? "desc").trim().toLowerCase();
  const normalizedPeriod = assertPeriod(period, from, to);

  if (!["appointmentDate", "amount", "status"].includes(sortBy)) {
    throw new AppError(400, "sortBy must be one of: appointmentDate, amount, status", "VALIDATION_ERROR");
  }

  if (!["asc", "desc"].includes(sortOrder)) {
    throw new AppError(400, "sortOrder must be asc or desc", "VALIDATION_ERROR");
  }

  return {
    period: normalizedPeriod,
    from,
    to,
    staffId,
    serviceId,
    branchId,
    search,
    sortBy: sortBy as "appointmentDate" | "amount" | "status",
    sortOrder: sortOrder as "asc" | "desc",
  };
}

function normalizeSalesDashboardQuery(query: SalesDashboardQuery) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const from = String(query.from ?? monthStart).trim() || monthStart;
  const to = String(query.to ?? today).trim() || today;
  const employeeId = String(query.employeeId ?? "").trim() || undefined;
  const employeeType = String(query.employeeType ?? "").trim() || undefined;
  const activity = String(query.activity ?? "all").trim().toLowerCase() || "all";
  const branchId = String(query.branchId ?? "").trim() || undefined;
  const groupBy = String(query.groupBy ?? "daily").trim().toLowerCase() as SalesDashboardTrendGroup;
  const search = String(query.search ?? "").trim();
  const sortBy = String(query.sortBy ?? "revenue").trim() as SalesDashboardEmployeeSortBy;
  const sortOrder = String(query.sortOrder ?? "desc").trim().toLowerCase() as SalesDashboardSortOrder;
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 10) || 10));
  const requestedSections = String(query.sections ?? "").trim();
  const sections = requestedSections
    ? Array.from(new Set(
      requestedSections
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )) as SalesDashboardSection[]
    : VALID_SALES_DASHBOARD_SECTIONS;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError(400, "from and to must be valid dates in YYYY-MM-DD format", "VALIDATION_ERROR");
  }

  if (new Date(`${from}T00:00:00Z`).getTime() > new Date(`${to}T00:00:00Z`).getTime()) {
    throw new AppError(400, "from cannot be greater than to", "VALIDATION_ERROR");
  }

  if (!VALID_SALES_DASHBOARD_GROUPS.includes(groupBy)) {
    throw new AppError(
      400,
      `groupBy must be one of: ${VALID_SALES_DASHBOARD_GROUPS.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  if (!VALID_SALES_DASHBOARD_SORTS.includes(sortBy)) {
    throw new AppError(
      400,
      `sortBy must be one of: ${VALID_SALES_DASHBOARD_SORTS.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  if (!VALID_SALES_DASHBOARD_SORT_ORDERS.includes(sortOrder)) {
    throw new AppError(400, "sortOrder must be asc or desc", "VALIDATION_ERROR");
  }

  if (sections.some((section) => !VALID_SALES_DASHBOARD_SECTIONS.includes(section))) {
    throw new AppError(
      400,
      `sections must be comma separated values from: ${VALID_SALES_DASHBOARD_SECTIONS.join(", ")}`,
      "VALIDATION_ERROR",
    );
  }

  if (!["all", "service", "product", "package", "membership", "gift_card"].includes(activity)) {
    throw new AppError(
      400,
      "activity must be one of: all, service, product, package, membership, gift_card",
      "VALIDATION_ERROR",
    );
  }

  return {
    from,
    to,
    employeeId,
    employeeType,
    activity,
    branchId,
    groupBy,
    search,
    sortBy,
    sortOrder,
    page,
    pageSize,
    sections,
  };
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
      { key: "center", type: "multi-select", label: "Centers", options: [
        { value: "main_branch", label: "Main Branch" },
      ]},
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
        { key: "service_code",     label: "Service Code",     type: "text",   sortable: true },
        { key: "center_name",      label: "Center Name",      type: "text",   sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "inactive_days", type: "dropdown", label: "Inactive Since", options: [
        { value: "30", label: "30 Days" }, { value: "60", label: "60 Days" },
        { value: "90", label: "90 Days" }, { value: "180", label: "180 Days" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "guest_name",      label: "Guest Name",     type: "text",     sortable: true },
        { key: "phone",           label: "Phone",          type: "text",     sortable: true },
        { key: "last_visit_date", label: "Last Visit Date",type: "date",     sortable: true },
        { key: "total_visits",    label: "Total Visits",   type: "number",   sortable: true },
        { key: "total_spent",     label: "Total Spent",    type: "currency", sortable: true },
        { key: "center_name",     label: "Center",         type: "text",     sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "payment_method", type: "multi-select", label: "Payment Method", options: [
        { value: "cash", label: "Cash" }, { value: "card", label: "Card" },
        { value: "upi",  label: "UPI" },  { value: "wallet", label: "Wallet" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "date",           label: "Date",           type: "date",     sortable: true },
        { key: "ticket_no",      label: "Ticket No",      type: "link",     sortable: true },
        { key: "guest_name",     label: "Guest Name",     type: "text",     sortable: true },
        { key: "payment_method", label: "Payment Method", type: "badge",    sortable: true },
        { key: "amount",         label: "Amount",         type: "currency", sortable: true },
        { key: "center_name",    label: "Center",         type: "text",     sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "service_category", type: "multi-select", label: "Service Category", options: [
        { value: "hair", label: "Hair" }, { value: "skin", label: "Skin" },
        { value: "nails", label: "Nails" }, { value: "spa", label: "Spa" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "service_name",     label: "Service Name", type: "text",     sortable: true },
        { key: "service_category", label: "Category",     type: "text",     sortable: true },
        { key: "bookings",         label: "Bookings",     type: "number",   sortable: true },
        { key: "revenue",          label: "Revenue",      type: "currency", sortable: true },
        { key: "avg_ticket",       label: "Avg Ticket",   type: "currency", sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "category", type: "multi-select", label: "Product Category", options: [
        { value: "hair_care", label: "Hair Care" }, { value: "hair_color", label: "Hair Color" },
        { value: "nails",     label: "Nails" },      { value: "skin_care",  label: "Skin Care" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "product",       label: "Product",       type: "text",     sortable: true },
        { key: "category",      label: "Category",      type: "text",     sortable: true },
        { key: "sku",           label: "SKU",           type: "text",     sortable: true },
        { key: "currentStock",  label: "Current Stock", type: "number",   sortable: true },
        { key: "reorderLevel",  label: "Reorder Level", type: "number",   sortable: true },
        { key: "unitCost",      label: "Unit Cost (₹)", type: "currency", sortable: true },
        { key: "totalValue",    label: "Total Value (₹)",type:"currency", sortable: true },
        { key: "status",        label: "Status",        type: "badge",    sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "type", type: "dropdown", label: "Consumption Type", options: [
        { value: "all", label: "All" }, { value: "service_use", label: "Service Use" },
        { value: "retail_sale", label: "Retail Sale" },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "provider", type: "multi-select", label: "Provider", options: [
        { value: "razorpay", label: "Razorpay" }, { value: "paytm",    label: "Paytm" },
        { value: "stripe",   label: "Stripe" },   { value: "payu",     label: "PayU" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "date",           label: "Date",           type: "date",     sortable: true },
        { key: "transactionId",  label: "Transaction ID", type: "link",     sortable: true },
        { key: "clientName",     label: "Guest Name",     type: "text",     sortable: true },
        { key: "gateway",        label: "Provider",       type: "badge",    sortable: true },
        { key: "amount",         label: "Amount",         type: "currency", sortable: true },
        { key: "status",         label: "Status",         type: "badge",    sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
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
      { key: "date",   type: "date-single",  label: "Date" },
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "channel", type: "multi-select", label: "Channel", options: [
        { value: "whatsapp", label: "WhatsApp" }, { value: "email",     label: "Email" },
        { value: "sms",      label: "SMS" },       { value: "instagram", label: "Instagram" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "clientName",  label: "Client Name",    type: "text",     sortable: true },
        { key: "phone",       label: "Phone",          type: "text",     sortable: true },
        { key: "status",      label: "Status",         type: "badge",    sortable: true },
        { key: "lastActivity",label: "Last Activity",  type: "date",     sortable: true },
        { key: "totalSales",  label: "Total Sales",    type: "currency", sortable: true },
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
      { key: "center", type: "multi-select", label: "Centers", options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "source", type: "multi-select", label: "Source", options: [
        { value: "online",   label: "Online" },  { value: "walk_in",  label: "Walk-in" },
        { value: "referral", label: "Referral" },{ value: "instagram",label: "Instagram" },
      ]},
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "clientName", label: "Client Name", type: "text", sortable: true },
        { key: "phone",      label: "Phone",       type: "text", sortable: true },
        { key: "source",     label: "Source",      type: "badge",sortable: true },
        { key: "firstVisit", label: "First Visit", type: "date", sortable: true },
      ],
    },
    data: [], pagination: EMPTY_PAGINATION,
  },
  // ── Employee (21 reports) ──────────────────────────────────────────────────
  ...[
    { id: "employee_attendance",         name: "Employee Attendance",              tags: ["Employee"],    description: "Track daily attendance, check-in and check-out times for all staff members across centers." },
    { id: "employee_performance",        name: "Employee Performance",             tags: ["Performance"], description: "Evaluate individual employee performance based on completed appointments, revenue, and client feedback." },
    { id: "employee_commission",         name: "Employee Commission",              tags: ["Commissions"], description: "Calculate and review commission earned by each employee based on services and products sold." },
    { id: "employee_sales",              name: "Employee Sales",                   tags: ["Sales"],       description: "View a detailed breakdown of total sales made by each employee including services and retail products." },
    { id: "employee_appointment_summary",name: "Employee Appointment Summary",     tags: ["Sales"],       description: "Summary of all appointments handled per employee with status breakdown and revenue contribution." },
    { id: "attrition",                   name: "Attrition",                        tags: ["Team"],        description: "Track the number of center employees who have either joined or left the organization." },
    { id: "block_out_time_details",      name: "Block Out Time Details",           tags: ["Time"],        description: "Show times when providers are on break or unavailable using Block Out Time Types." },
    { id: "booking_productivity",        name: "Booking Productivity",             tags: ["Sales"],       description: "Insight into the types of services requested by your guests by calling your center." },
    { id: "commissions",                 name: "Commissions",                      tags: ["Commissions"], description: "Commission earned by each employee based on services and products sold." },
    { id: "commissions_graphical",       name: "Commissions - Graphical",          tags: ["Commissions"], description: "Graphical breakdown of commission earned per employee." },
    { id: "employee_collections",        name: "Employee Collections",             tags: ["Sales"],       description: "View the collections made by each employee during a selected period." },
    { id: "employee_collections_by_item",name: "Employee Collections By Item Type",tags: ["Sales"],      description: "View details of the sales for each item type: services, products, memberships." },
    { id: "employee_sales_metrics",      name: "Employee Sales Metrics",           tags: ["Performance"], description: "Track all sales employees make in a selected time period." },
    { id: "guest_satisfaction",          name: "Guest Satisfaction",               tags: ["Performance"], description: "Evaluate client satisfaction scores across employees and services." },
    { id: "leaves",                      name: "Leaves",                           tags: ["Time"],        description: "Track the number of leaves availed by employees of each leave type as well as the status." },
    { id: "no_show_cancellation",        name: "No-show/Cancellation",             tags: ["Sales"],       description: "View a quick snapshot of guests who either did not come in for their appointments." },
    { id: "overtime",                    name: "Overtime",                         tags: ["Time"],        description: "Track overtime hours worked by each employee." },
    { id: "overtime_summary",            name: "Overtime Summary",                 tags: ["Time"],        description: "Track the number of extra hours spent by your center." },
    { id: "rebooking",                   name: "Rebooking",                        tags: ["Sales"],       description: "Track rebooking rates and patterns for clients and employees." },
    { id: "staffing",                    name: "Staffing",                         tags: ["Team"],        description: "Track the total number of employees currently working in a center, categorized by role." },
    { id: "utilization",                 name: "Utilization",                      tags: ["Performance"], description: "Track how effectively employees' working hours are being utilized across services and appointments." },
  ].map(r => ({
    ...r,
    category: "employee",
    isNewVersion: false,
    isBookmarked: false,
    permissions: { view: true, export: true, saveView: true, refresh: true },
    filters: [
      { key: "date", type: "date-range", label: "Date", fromKey: "date_from", toKey: "date_to" },
      { key: "center",   type: "multi-select", label: "Centers",  options: [{ value: "main_branch", label: "Main Branch" }] },
      { key: "employee", type: "multi-select", label: "Employee", options: [] },
    ],
    tableConfig: {
      rowsPerPage: [10, 25, 50, 100],
      columns: [
        { key: "employee_name", label: "Employee Name", type: "text",     sortable: true },
        { key: "appointments",  label: "Appointments",  type: "number",   sortable: true },
        { key: "revenue",       label: "Revenue",       type: "currency", sortable: true },
        { key: "center_name",   label: "Center",        type: "text",     sortable: true },
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

  async getRevenueByService(salonId: string, period: string, from?: string, to?: string) {
    assertSalonId(salonId);
    return reportsRepository.getRevenueByService(salonId, assertPeriod(period, from, to), from, to);
  },

  async getRevenueByServiceDetail(
    salonId: string,
    serviceId: string,
    startDate: string,
    endDate: string,
    branchId?: string,
    staffId?: string,
  ) {
    assertSalonId(salonId);
    if (!serviceId) throw new AppError(400, "serviceId is required", "VALIDATION_ERROR");
    if (!startDate || !endDate) {
      throw new AppError(400, "startDate and endDate are required", "VALIDATION_ERROR");
    }

    resolveRevenueDateRange("custom", startDate, endDate);

    return reportsRepository.getRevenueByServiceDetail(
      salonId,
      serviceId,
      startDate,
      endDate,
      branchId,
      staffId,
    );
  },

  async getRevenueByServiceCategory(
    salonId: string,
    period: string,
    from?: string,
    to?: string,
    categoryId?: string,
    branchId?: string,
    staffId?: string,
    search?: string,
    sortBy?: string,
  ) {
    assertSalonId(salonId);
    return reportsRepository.getRevenueByServiceCategory(
      salonId,
      assertPeriod(period, from, to),
      from,
      to,
      categoryId,
      branchId,
      staffId,
      search,
      sortBy,
    );
  },

  async getRevenueByServiceCategoryDetail(
    salonId: string,
    categoryId: string,
    period: string,
    from?: string,
    to?: string,
    branchId?: string,
    staffId?: string,
  ) {
    assertSalonId(salonId);
    if (!categoryId) throw new AppError(400, "categoryId is required", "VALIDATION_ERROR");
    return reportsRepository.getRevenueByServiceCategoryDetail(
      salonId,
      categoryId,
      assertPeriod(period, from, to),
      from,
      to,
      branchId,
      staffId,
    );
  },

  async getAppointments(salonId: string, query: AppointmentAnalyticsQuery) {
    assertSalonId(salonId);
    return reportsRepository.getAppointments(salonId, normalizeAppointmentAnalyticsQuery(query));
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

  async getEmployeePerformance(salonId: string, query: EmployeePerformanceQuery) {
    assertSalonId(salonId);
    return reportsRepository.getEmployeePerformance(
      salonId,
      normalizeEmployeePerformanceQuery(query),
    );
  },

  async getStaffRevenueAnalytics(salonId: string, query: StaffRevenueAnalyticsQuery) {
    assertSalonId(salonId);
    return reportsRepository.getStaffRevenueAnalytics(
      salonId,
      normalizeStaffRevenueAnalyticsQuery(query),
    );
  },

  async getStaffProductSales(salonId: string, query: StaffProductSalesQuery) {
    assertSalonId(salonId);
    return reportsRepository.getStaffProductSales(
      salonId,
      normalizeStaffProductSalesQuery(query),
    );
  },

  async getStaffServiceSales(salonId: string, query: StaffServiceSalesQuery) {
    assertSalonId(salonId);
    return reportsRepository.getStaffServiceSales(
      salonId,
      normalizeStaffServiceSalesQuery(query),
    );
  },

  async getSalesDashboard(salonId: string, query: SalesDashboardQuery): Promise<SalesDashboardResponse> {
    assertSalonId(salonId);
    return reportsRepository.getSalesDashboard(
      salonId,
      normalizeSalesDashboardQuery(query),
    );
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

  // ── Detail views ─────────────────────────────────────────────────────────────
  async getAppointmentsDetail(
    salonId: string, dateType: string, from: string, to: string, statuses: string[],
  ) {
    assertSalonId(salonId);
    return reportsRepository.getAppointmentsDetail(salonId, dateType, from, to, statuses);
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
};
