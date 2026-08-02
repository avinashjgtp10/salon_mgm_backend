// ===============================
// Query Params
// ===============================

export type SalesSummaryPeriod =
    | "today"
    | "weekly"
    | "monthly"
    | "yearly";

export const SALES_SUMMARY_PERIODS: SalesSummaryPeriod[] = [
    "today",
    "weekly",
    "monthly",
    "yearly",
];

export interface SalesSummaryQuery {
    period?: string;
    from?: string;
    to?: string;
    salon_id?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
}

export interface ResolvedDateRange {
    period: SalesSummaryPeriod;
    from: string;
    to: string;
}

// ===============================
// Response Models
// ===============================

export interface SalesSummaryFilters {
    period: SalesSummaryPeriod;
    from: string;
    to: string;
}

export interface RevenueCategoryTotals {
    grossSale: number;

    serviceNetSale: number;

    productNetSale: number;

    packageNetSale: number;

    membershipNetSale: number;

    giftCardNetSale: number;
}

export interface RevenueSources extends RevenueCategoryTotals {
    totalRevenue: number;
}

export interface SalesAdjustments {
    discount: number;
    tax: number;
    refund: number;
}

export interface FootfallSummary {
    totalGuest: number;

    newGuest: number;

    repeatGuest: number;

    guestPurchasedServices: number;
}

export interface AverageSaleSummary {
    averageBillValue: number;

    averageGuestSpend: number;

    averageServicePerInvoice: number;
}

// ===============================
// Top 5 Sales
// ===============================

export interface TopServiceSaleItem {
    id: string;

    serviceName: string;

    quantitySold: number;

    revenue: number;
}

export interface TopProductSaleItem {
    id: string;

    productName: string;

    quantitySold: number;

    revenue: number;
}

export interface TopMembershipSaleItem {
    id: string;

    membershipName: string;

    count: number;

    revenue: number;
}

export interface TopPackageSaleItem {
    id: string;

    packageName: string;

    count: number;

    revenue: number;
}

export interface TopStylistSaleItem {
    id: string;

    stylistName: string;

    bookingCount: number;

    revenue: number;
}

// ===============================
// Final API Response
// ===============================

export interface SalesSummaryData {
    filters: SalesSummaryFilters;

    summaryCards: RevenueCategoryTotals;

    revenueSources: RevenueSources;

    adjustments: SalesAdjustments;

    footfallSummary: FootfallSummary;

    averageSaleSummary: AverageSaleSummary;

    top5ServiceSales: TopServiceSaleItem[];

    top5ProductSales: TopProductSaleItem[];

    top5MembershipSales: TopMembershipSaleItem[];

    top5PackageSales: TopPackageSaleItem[];

    top5StylistSales: TopStylistSaleItem[];
}

export interface SalesSummaryTableItemDetail {
    itemType: string;
    itemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    total: number;
    staffName: string;
}

export interface SalesSummaryTableRow {
    saleId: string;
    invoiceNo: string;
    date: string;
    customerName: string;
    mobile: string;
    staffName: string;
    paymentMethod: string;
    paymentStatus: string;
    saleStatus: string;
    grossAmount: number;
    discount: number;
    tax: number;
    tip: number;
    netAmount: number;
    collectedAmount: number;
    pendingAmount: number;
    totalQuantity: number;
    services: string;
    products: string;
    packages: string;
    memberships: string;
    giftCards: string;
    otherItems: string;
    itemDetails: SalesSummaryTableItemDetail[];
    notes: string;
}

export interface SalesSummaryTableData {
    rows: SalesSummaryTableRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

// ===============================
// Repository Rows
// ===============================

export interface CategoryTotalsRow {
    item_type: string;

    gross: string;

    net: string;

    qty: string;
}

export interface InvoiceAdjustmentsRow {
    invoice_count: string;

    extra_discount_total: string;

    tax_total: string;

    refund_total: string;
}

export interface FootfallRow {
    total_guest: string;

    new_guest: string;

    guest_purchased_services: string;
}

export interface TopItemRow {
    id: string | null;

    name: string;

    qty: string;

    revenue: string;
}

export interface TopStylistRow {
    id: string;

    first_name: string | null;

    last_name: string | null;

    booking_count: string;

    revenue: string;
}

export interface BalanceReceivedReportFilters {
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
}

export interface BalanceReceivedCard {
    title: string;
    value: string;
    trend: string;
}

export interface BalanceReceivedChartPoint {
    day: string;
    date: string;
    amount: number;
}

export interface BalanceReceivedDistributionItem {
    name: string;
    value: number;
}

export interface BalanceReceivedAnalyticsItem {
    title: string;
    value: string;
    subtitle: string;
    color: string;
    icon: string;
}

export interface BalanceReceivedTableRow {
    receiptNo: string;
    paymentDate: string;
    customerName: string;
    mobile: string;
    invoiceNo: string;
    staffName: string;
    paymentMethod: string;
    amountReceived: number;
    previousBalance: number;
    remainingBalance: number;
    paymentStatus: string;
    notes: string;
}

export interface BalanceReceivedTableData {
    rows: BalanceReceivedTableRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface BalanceReceivedReportData {
    cards: BalanceReceivedCard[];
    charts: {
        dailyBalanceCollection: BalanceReceivedChartPoint[];
        paymentModeDistribution: BalanceReceivedDistributionItem[];
        staffCollectionPerformance: BalanceReceivedDistributionItem[];
        paymentStatus: BalanceReceivedDistributionItem[];
    };
    analytics: BalanceReceivedAnalyticsItem[];
    table: BalanceReceivedTableData;
}

export interface DayWiseReportFilters {
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
}

export interface DayWiseCard {
    title: string;
    value: string;
    trend: string;
    color: string;
    icon: string;
}

export interface DayWiseRevenuePoint {
    day: string;
    revenue: number;
}

export interface DayWiseAppointmentPoint {
    day: string;
    appointments: number;
}

export interface DayWiseStaffProductivityPoint {
    staffName: string;
    revenue: number;
    appointments: number;
    services: number;
}

export interface DayWisePaymentModePoint {
    name: string;
    value: number;
}

export interface DayWiseAnalyticsItem {
    title: string;
    value: string;
    subtitle: string;
    color: string;
    icon: string;
}

export interface DayWiseTableRow {
    invoiceNo: string;
    date: string;
    customerName: string;
    mobile: string;
    appointmentCount: number;
    services: string;
    products: string;
    grossAmount: number;
    discount: number;
    tax: number;
    netAmount: number;
    paymentMode: string;
    collectedAmount: number;
    pendingAmount: number;
    staffName: string;
    status: string;
    notes: string;
}

export interface DayWiseTableData {
    rows: DayWiseTableRow[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface DayWiseReportData {
    cards: DayWiseCard[];
    charts: {
        dailyRevenue: DayWiseRevenuePoint[];
        appointmentTrend: DayWiseAppointmentPoint[];
        staffProductivity: DayWiseStaffProductivityPoint[];
        paymentModeSummary: DayWisePaymentModePoint[];
    };
    analytics: DayWiseAnalyticsItem[];
    table: DayWiseTableData;
}

export interface CouponRedemptionCard {
    title: string;
    value: string;
    trend: string;
    color: string;
}

export interface CouponRedemptionChartPoint {
    day: string;
    redemptions?: number;
    discount?: number;
    value?: number;
    amount?: number;
    revenue?: number;
}

export interface CouponRedemptionAnalyticsItem {
    title: string;
    value: string;
    subtitle: string;
    color: string;
    icon: string;
}

export interface CouponRedemptionTableRow {
    saleId: string;
    invoiceNo: string;
    couponCode: string;
    couponType: string;
    couponValue: number;
    customerName: string;
    mobile: string;
    orderAmount: number;
    discountAmount: number;
    netAmount: number;
    paymentMethod: string;
    staffName: string;
    usedAt: string;
    status: string;
}

export interface CouponRedemptionTableData {
    rows: CouponRedemptionTableRow[];
}

export interface CouponRedemptionReportData {
    cards: CouponRedemptionCard[];
    charts: {
        redemptionTrend: CouponRedemptionChartPoint[];
        topCoupons: CouponRedemptionChartPoint[];
        couponTypeDistribution: CouponRedemptionChartPoint[];
    };
    analytics: CouponRedemptionAnalyticsItem[];
    table: CouponRedemptionTableData;
}

export interface StaffCommissionCard {
    title: string;
    value: string;
    trend: string;
    color: string;
    icon: string;
}

export interface StaffCommissionChartPoint {
    day?: string;
    name?: string;
    value?: number;
    amount?: number;
    commission?: number;
}

export interface StaffCommissionAnalyticsItem {
    title: string;
    value: string;
    subtitle: string;
    color: string;
    icon: string;
}

export interface StaffCommissionTableRow {
    date: string;
    invoiceNo: string;
    customerName: string;
    mobile: string;
    staffName: string;
    itemType: string;
    itemName: string;
    quantity: number;
    revenueAmount: number;
    commissionRate: number;
    commissionKind: string;
    commissionAmount: number;
    payoutStatus: string;
    paymentStatus: string;
    source: string;
}

export interface StaffCommissionTableData {
    rows: StaffCommissionTableRow[];
}

export interface StaffCommissionReportData {
    cards: StaffCommissionCard[];
    charts: {
        commissionTrend: StaffCommissionChartPoint[];
        categoryBreakdown: StaffCommissionChartPoint[];
        topStaff: StaffCommissionChartPoint[];
        payoutStatus: StaffCommissionChartPoint[];
    };
    analytics: StaffCommissionAnalyticsItem[];
    table: StaffCommissionTableData;
}



// ======================================================
// INDEPENDENT REPORT API TYPES — used by the new POST /api/report/*
// endpoints, which read sales/sale_items/payments/appointments directly
// via SQL rather than the legacy report handlers above.
// ======================================================

// ===============================
// Sales Summary (independent report API — POST /api/report/sales-summary)
// Reads directly from sales/sale_items/payments tables. Must never call the
// Appointment API/service — appointments is only ever JOINed for context.
// ===============================

export interface SalesSummaryReportFilters {
    start_date?: string;
    end_date?: string;
    staff_id?: string;
    search?: string;
    status?: string; // 'draft' | 'completed' | 'cancelled' | 'refunded'; default excludes 'draft'
    category_id?: string; // service_categories.id — only sales with a service line item in this category
    payment_mode?: string; // sales.payment_method
    item_type?: string; // sale_items.item_type — 'service' | 'product' | 'membership' | 'gift_card' | 'quick' | 'package'
    service_id?: string; // sale_items.item_id where item_type = 'service'
    page?: number;
    limit?: number;
    is_export?: boolean; // bypasses the page-size cap for CSV export
}

export interface SalesSummaryFiltersAvailable {
    service_categories: { id: string; label: string }[];
    staff: { id: string; label: string }[];
    services: { id: string; label: string }[];
    payment_modes: string[];
}

export interface SalesSummaryReportRow {
    id: string;
    appointment_id: string | null;
    invoice_number: string | null;
    client_name: string | null;
    client_phone: string | null;
    item_description: string;
    item_types: string;
    actual_price: number;
    price: number;
    discount_amount: number;
    tax_amount: number;
    paid_amount: number;
    due_amount: number;
    tip_amount: number;
    ewallet_used: number;
    membership_wallet_used: number;
    reward_points_value: number;
    referral_credit_used: number;
    payment_method: string | null;
    status: string;
    created_at: string;
    staff_name: string | null;
}

export interface SalesSummaryReportStats {
    total_bill: number;
    bill_average: number;
    total_sale: number;
    received_amount: number;
    total_tip: number;
    total_ewallet: number;
    total_membership: number;
    total_rewards: number;
    total_referral: number;
}

export interface SalesSummaryReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface SalesSummaryReportResponse {
    rows: SalesSummaryReportRow[];
    pagination: SalesSummaryReportPagination;
    stats: SalesSummaryReportStats;
    filters_available: SalesSummaryFiltersAvailable;
}

export interface SaleDetailHeader {
    id: string;
    invoice_number: string | null;
    status: string;
    created_at: string;
    client_name: string | null;
    client_phone: string | null;
    staff_name: string | null;
    subtotal: number;
    discount_amount: number;
    tip_amount: number;
    tax_amount: number;
    ex_charges: number;
    total_amount: number;
    payment_method: string | null;
    payment_reference: string | null;
    notes: string | null;
    coupon_code: string | null;
    discount_percent: number | null;
    discount_type: string | null;
    appointment_id: string | null;
}

export interface SaleDetailItem {
    id: string;
    item_type: string;
    item_id: string | null;
    name: string;
    quantity: number;
    unit_price: number;
    discount_amount: number;
    total_price: number;
    staff_name: string | null;
}

export interface SaleDetailPayment {
    paid_amount: number;
    due_amount: number;
    ewallet_used: number;
    membership_wallet_used: number;
    reward_points_value: number;
    referral_credit_used: number;
    tax_breakdown: any[] | null;
}

export interface SaleDetailResponse {
    sale: SaleDetailHeader | null;
    items: SaleDetailItem[];
    payment: SaleDetailPayment | null;
}

// ===============================
// Daily Sheet (independent report API — POST /api/report/daily-sheet)
// Reads directly from sales/sale_items tables, one row per line item. Must
// never call the Appointment API/service — appointments is not consulted.
// ===============================

export interface DailySheetReportFilters {
    date?: string;
    service_id?: string;
    staff_ids?: string[];
    search?: string;
    payment_mode?: string;
    status?: string;
    item_type?: string;
    time_from?: string;
    time_to?: string;
    page?: number;
    limit?: number;
    is_export?: boolean; // bypasses the page-size cap for CSV export
}

export interface DailySheetReportRow {
    appointment_id: string | null;
    sale_id: string;
    time: string;
    ticket_no: string;
    client_id: string | null;
    client_name: string | null;
    service_id: string | null;
    service: string;
    item_type: string | null;
    staff_id: string | null;
    staff: string | null;
    amount: number;
    payment_method: string | null;
    status: string;
}

export interface DailySheetReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface DailySheetFilterOption {
    id: string;
    label: string;
}

export interface DailySheetFiltersAvailable {
    services: DailySheetFilterOption[];
    staff: DailySheetFilterOption[];
    payment_modes: string[];
}

export interface DailySheetReportResponse {
    rows: DailySheetReportRow[];
    pagination: DailySheetReportPagination;
    total_amount: number;
    // invoice_count = distinct invoices/appointments (NOT the same as
    // pagination.total, which counts line-item rows since Daily Sheet is
    // one-row-per-item); items_count === pagination.total, kept as an
    // explicit field so the frontend stat card doesn't need to know that.
    invoice_count: number;
    client_count: number;
    staff_count: number;
    items_count: number;
    filters_available: DailySheetFiltersAvailable;
}

// ===============================
// Product Retail (independent report API — POST /api/report/product-retail)
// Reads directly from sales/sale_items (item_type = 'product'), one row per
// line item. Must never call the Appointment API/service.
// ===============================

export interface ProductRetailReportFilters {
    start_date?: string;
    end_date?: string;
    product_id?: string;
    search?: string;
    staff_ids?: string[];
    brand_id?: string;
    category_id?: string;
    min_price?: number;
    max_price?: number;
    page?: number;
    limit?: number;
    is_export?: boolean; // bypasses the page-size cap for CSV export
}

export interface ProductRetailReportRow {
    sale_id: string;
    date: string;
    invoice_no: string;
    client_id: string | null;
    client_name: string | null;
    staff_id: string | null;
    staff_name: string | null;
    product_id: string | null;
    product_name: string;
    brand_id: string | null;
    brand_name: string | null;
    category_id: string | null;
    category_name: string | null;
    quantity: number;
    price: number;
    total: number;
    tax_amount: number;
    taxable_amount: number;
    payment_method: string | null;
    status: string;
}

export interface ProductRetailReportStats {
    total_quantity: number;
    total_revenue: number;
    unique_products: number;
    line_items: number;
}

export interface ProductRetailReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ProductRetailFilterOption {
    id: string;
    label: string;
}

export interface ProductRetailReportResponse {
    rows: ProductRetailReportRow[];
    pagination: ProductRetailReportPagination;
    stats: ProductRetailReportStats;
    filters_available: {
        products: ProductRetailFilterOption[];
        staff: ProductRetailFilterOption[];
        brands: ProductRetailFilterOption[];
        categories: ProductRetailFilterOption[];
    };
}

// ===============================
// Service Sale (independent report API — POST /api/report/service-sale)
// Reads directly from sales/sale_items (item_type = 'service'), one row per
// line item. Must never call the Appointment API/service. Excludes sales
// with status = 'draft' (the closest equivalent of the old "Unpaid" hide).
// ===============================

export interface ServiceSaleReportFilters {
    start_date?: string;
    end_date?: string;
    staff_ids?: string[];
    category_id?: string;
    service_id?: string;
    min_price?: number;
    max_price?: number;
    payment_method?: string;
    search?: string;
    sort_by?: "date" | "invoice_no" | "service_name" | "staff_name" | "price" | "total";
    sort_dir?: "asc" | "desc";
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ServiceSaleReportRow {
    sale_id: string;
    date: string;
    invoice_no: string;
    client_id: string | null;
    client_name: string | null;
    staff_id: string | null;
    staff_name: string | null;
    service_id: string | null;
    service_name: string;
    category_id: string | null;
    category_name: string | null;
    price: number;
    // This line item's own GST + the post-discount/post-wallet base it was
    // computed on (see pricing.engine.ts's per-row allocation). 0 for sales
    // recorded before per-item tax existed.
    tax_amount: number;
    taxable_amount: number;
    payment_method: string | null;
    status: string;
}

export interface ServiceSaleReportStats {
    services_sold: number;
    total_revenue: number;
    avg_ticket: number;
    unique_services: number;
    // Most-frequently-sold service by line-item count in the filtered period —
    // null when there are no matching rows.
    top_service: { name: string; count: number } | null;
}

export interface ServiceSaleReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ServiceSaleFilterOption {
    id: string;
    label: string;
}

export interface ServiceSaleReportResponse {
    rows: ServiceSaleReportRow[];
    pagination: ServiceSaleReportPagination;
    stats: ServiceSaleReportStats;
    filters_available: {
        staff: ServiceSaleFilterOption[];
    };
}

// ===============================
// GST / Taxes Report (independent report API — POST /api/report/gst)
// Reads directly from sales, one row per invoice. sales.tax_amount is a
// single flat number — there is no per-tax-name breakdown on this table
// (only payments.tax_breakdown has that, and only for appointment-linked
// sales), so this report shows one flat "Tax Amount" column, not a dynamic
// CGST/SGST-style split. Must never call the Appointment API/service.
// ===============================

export interface GstReportFilters {
    start_date?: string;
    end_date?: string;
    staff_id?: string;
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface GstReportRow {
    sale_id: string;
    date: string;
    invoice_no: string;
    client_name: string | null;
    taxable_amount: number;
    tax_amount: number;
    total: number;
}

export interface GstReportStats {
    invoices_with_tax: number;
    total_tax_collected: number;
    total_amount_collected: number;
}

export interface GstReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface GstReportResponse {
    rows: GstReportRow[];
    pagination: GstReportPagination;
    stats: GstReportStats;
}

// ===============================
// Product Margin (independent report API — POST /api/report/product-margin)
// Reads directly from sale_items (item_type = 'product') joined against
// products.supply_price for cost, aggregated by product name. Must never
// call the Appointment API/service.
// ===============================

export interface ProductMarginReportFilters {
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ProductMarginReportRow {
    product_name: string;
    quantity: number;
    revenue: number;
    cost: number;
    profit: number;
    margin_pct: number;
}

export interface ProductMarginReportStats {
    total_revenue: number;
    total_cost: number;
    total_profit: number;
    avg_margin_pct: number;
}

export interface ProductMarginReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ProductMarginReportResponse {
    rows: ProductMarginReportRow[];
    pagination: ProductMarginReportPagination;
    stats: ProductMarginReportStats;
}

// ===============================
// Reward Points Report (independent report API — POST /api/report/reward-points)
// Reads directly from clients.reward_points_balance and reward_points_ledger,
// one row per client. Never calls the Appointment API/service.
// ===============================

export interface RewardPointsReportFilters {
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface RewardPointsReportRow {
    client_id: string;
    client_name: string;
    mobile: string;
    points_available: number;
    points_earned: number;
    points_redeemed: number;
    last_activity_at: string | null;
}

export interface RewardPointsReportStats {
    points_available: number;
    total_points_earned: number;
    total_points_redeemed: number;
}

export interface RewardPointsReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface RewardPointsReportResponse {
    rows: RewardPointsReportRow[];
    pagination: RewardPointsReportPagination;
    stats: RewardPointsReportStats;
}

// ===============================
// E-Wallet Report (independent report API — POST /api/report/ewallet)
// Reads directly from clients.ewallet_balance, one row per client. Row-click
// drill-down keeps using the existing GET /api/v1/ewallet/:clientId/breakdown
// and /ledger endpoints (already independent of the Appointment API).
// ===============================

export interface EwalletReportFilters {
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface EwalletReportRow {
    client_id: string;
    client_name: string;
    phone: string;
    email: string;
    balance: number;
}

export interface EwalletReportStats {
    total_clients: number;
    with_balance: number;
    total_wallet_value: number;
    avg_balance: number;
}

export interface EwalletReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface EwalletReportResponse {
    rows: EwalletReportRow[];
    pagination: EwalletReportPagination;
    stats: EwalletReportStats;
}

// ===============================
// Client Revenue Report (independent report API — POST /api/report/client-revenue)
// Reads directly from sales/clients, grouped by client_id, one row per
// client (visits/spend/avg-ticket/last-visit). Only sales with a paid amount
// > 0 count (mirrors the old report's paid_amount > 0 inclusion rule). Must
// never call the Appointment API/service.
// ===============================

export interface ClientRevenueReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ClientRevenueReportRow {
    client_id: string | null;
    client_name: string;
    contact: string;
    visits: number;
    total_spend: number;
    avg_ticket: number;
    last_visit: string;
}

export interface ClientRevenueReportStats {
    total_clients: number;
    total_revenue: number;
    avg_spend_per_client: number;
    top_client: string;
}

export interface ClientRevenueReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ClientRevenueReportResponse {
    rows: ClientRevenueReportRow[];
    pagination: ClientRevenueReportPagination;
    stats: ClientRevenueReportStats;
}

// ===============================
// Staff Sales Report (independent report API — POST /api/report/staff-sales)
// Reads directly from sales/sale_items, bucketed by period (daily/weekly/
// monthly/yearly) and optionally filtered to one staff member. Must never
// call the Appointment API/service.
// ===============================

export type StaffSalesPeriod = "daily" | "weekly" | "monthly" | "yearly";

export interface StaffSalesReportFilters {
    start_date?: string;
    end_date?: string;
    period?: StaffSalesPeriod;
    staff_id?: string;
}

export interface StaffSalesReportRow {
    label: string;
    bucket_date: string;
    service_revenue: number;
    product_revenue: number;
    total: number;
}

export interface StaffSalesReportResponse {
    rows: StaffSalesReportRow[];
}

// ===============================
// Staff Item Sales Report (independent report API —
// POST /api/report/staff-item-sales)
// Reads directly from sale_items (one item_type at a time: service, product,
// membership, package), one row per line item, joined to staff for names.
// Must never call the Appointment API/service.
// ===============================

export type StaffItemSalesType = "service" | "product" | "membership" | "package";

export interface StaffItemSalesReportFilters {
    start_date?: string;
    end_date?: string;
    item_type?: StaffItemSalesType;
    staff_id?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface StaffItemSalesReportRow {
    staff_id: string | null;
    staff_name: string;
    item_name: string;
    quantity: number;
    revenue: number;
    date: string;
}

export interface StaffItemSalesReportStats {
    total_quantity: number;
    total_revenue: number;
    top_item: string;
    top_staff: string;
}

export interface StaffItemSalesReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface StaffItemSalesReportResponse {
    rows: StaffItemSalesReportRow[];
    pagination: StaffItemSalesReportPagination;
    stats: StaffItemSalesReportStats;
}

// ===============================
// Package Sale Report (independent report API — POST /api/report/package-sale)
// Reads directly from client_packages, one row per package sale. Never
// touches the Appointment API (this domain was never on it anyway).
// ===============================

export interface PackageSaleReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    package_name?: string;
    package_status?: string;
    payment_status?: string;
    payment_method?: string;
    min_amount?: number;
    max_amount?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface PackageSaleReportRow {
    id: string;
    date: string;
    client_id: string | null;
    client_name: string;
    package_name: string;
    total_amount: number;
    paid_amount: number;
    pending_amount: number;
    payment_status: string;
    // Computed at package-purchase time (client-packages.repository.ts),
    // independent of pricing.engine.ts — this row IS the whole sale, so it's
    // trivially "per item" already, unlike sale_items-derived reports.
    gst_amount: number;
    // Via client_packages.sale_id -> sales.invoice_number. NULL for package
    // sales recorded before staff_id/sale_id existed.
    invoice_no: string | null;
    staff_id: string | null;
    staff_name: string | null;
    payment_method: string;
    // Package status (Active/Completed/...) — distinct from payment_status.
    status: string;
}

export interface PackageSaleReportStats {
    packages_sold: number;
    total_sale_value: number;
    total_received: number;
    unique_packages: number;
    outstanding_balance: number;
}

export interface PackageSaleReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface PackageSaleFilterOption {
    id: string;
    label: string;
}

export interface PackageSaleReportResponse {
    rows: PackageSaleReportRow[];
    pagination: PackageSaleReportPagination;
    stats: PackageSaleReportStats;
    filters_available: {
        staff: PackageSaleFilterOption[];
        packages: string[];
    };
}

// ===============================
// Package History Report (independent report API —
// POST /api/report/package-history)
// Reads directly from client_package_session_history joined to
// client_package_services/client_packages, one row per session. Never
// touches the Appointment API.
// ===============================

export interface PackageHistoryReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface PackageHistoryReportRow {
    date: string;
    client_id: string | null;
    client_name: string;
    package_name: string;
    service_name: string;
    session_no: number;
    staff: string;
    status: string;
}

export interface PackageHistoryReportStats {
    total_sessions: number;
    completed_sessions: number;
    unique_clients: number;
    unique_packages: number;
}

export interface PackageHistoryReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface PackageHistoryReportResponse {
    rows: PackageHistoryReportRow[];
    pagination: PackageHistoryReportPagination;
    stats: PackageHistoryReportStats;
}

// ===============================
// Member Sale Report (independent report API — POST /api/report/member-sale)
// Reads directly from client_memberships, one row per membership sale. Never
// touches the Appointment API.
// ===============================

export interface MemberSaleReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface MemberSaleReportRow {
    id: string;
    client_id: string | null;
    purchased_at: string;
    client_name: string;
    membership_name: string;
    price_paid: number;
    total_sessions: number;
    used_sessions: number;
    status: string;
}

export interface MemberSaleReportStats {
    memberships_sold: number;
    total_revenue: number;
    active_memberships: number;
}

export interface MemberSaleReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface MemberSaleReportResponse {
    rows: MemberSaleReportRow[];
    pagination: MemberSaleReportPagination;
    stats: MemberSaleReportStats;
}

// ===============================
// Appointment Detail Report (independent report API —
// POST /api/report/appointment-detail)
// Reads directly from the appointments table (JOIN clients/staff/payments),
// one row per service in the appointment's services JSONB array. This is
// genuinely appointment-shaped data (duration, booked-vs-scheduled dates),
// so it queries `appointments` directly via SQL — this is NOT the same as
// calling the Appointment HTTP API/service, which remains off-limits.
// ===============================

export interface AppointmentDetailReportFilters {
    from?: string;
    to?: string;
    statuses?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface AppointmentDetailReportRow {
    id: string;
    appointment_date: string;
    time: string;
    booked_date: string;
    client_name: string | null;
    service_name: string;
    staff_name: string | null;
    duration: number;
    amount: number;
    payment_method: string | null;
    payment_status: string;
}

export interface AppointmentDetailReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface AppointmentDetailReportResponse {
    rows: AppointmentDetailReportRow[];
    pagination: AppointmentDetailReportPagination;
}
