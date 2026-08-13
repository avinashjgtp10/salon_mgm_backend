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
    staff_ids?: string[];
    search?: string;
    status?: string; // 'draft' | 'completed' | 'cancelled' | 'refunded'; default excludes 'draft'
    category_id?: string; // service_categories.id — only sales with a service line item in this category
    category_ids?: string[];
    payment_mode?: string; // sales.payment_method
    payment_modes?: string[];
    item_type?: string; // sale_items.item_type — 'service' | 'product' | 'membership' | 'gift_card' | 'quick' | 'package'
    item_types?: string[];
    service_id?: string; // sale_items.item_id where item_type = 'service'
    service_ids?: string[];
    // Displayed-status vocabulary ('paid' | 'booked' | 'cancelled' | 'refunded'),
    // not the raw sales.status the `status` field above filters on.
    payment_status?: string;
    payment_statuses?: string[];
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
    coupon_code: string | null;
    coupon_discount_amount: number;
    referral_discount_amount: number;
    tax_amount: number;
    paid_amount: number;
    due_amount: number;
    tip_amount: number;
    ewallet_used: number;
    membership_wallet_used: number;
    // ₹ of this bill covered by an already-purchased package's sessions.
    package_used: number;
    reward_points_value: number;
    referral_credit_used: number;
    payment_method: string | null;
    payment_reference: string | null;
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
    // ₹ across these bills covered by already-purchased package sessions.
    total_package: number;
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
    manual_discount_amount: number;
    coupon_id: string | null;
    coupon_discount_amount: number;
    coupon_discount_type: string | null;
    referral_discount_amount: number;
    referral_id: string | null;
    referral_source: string | null;
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
    service_ids?: string[];
    staff_ids?: string[];
    search?: string;
    payment_mode?: string;
    payment_modes?: string[];
    status?: string;
    statuses?: string[];
    item_type?: string;
    item_types?: string[];
    time_from?: string;
    time_to?: string;
    page?: number;
    limit?: number;
    is_export?: boolean; // bypasses the page-size cap for CSV export
}

export interface DailySheetReportRow {
    appointment_id: string | null;
    sale_id: string;
    date: string;
    booking_time: string;
    // When the invoice/bill was actually created (sales.created_at). Distinct
    // from `booking_time` (the appointment/booking slot) — null for an
    // appointment row that hasn't been billed yet.
    bill_time: string | null;
    ticket_no: string;
    client_id: string | null;
    client_name: string | null;
    service_id: string | null;
    service: string;
    item_type: string | null;
    staff_id: string | null;
    staff: string | null;
    amount: number;
    paid_amount: number;
    due_amount: number;
    payment_method: string | null;
    payment_reference: string | null;
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
    total_paid: number;
    total_due: number;
    // invoice_count = distinct invoices/appointments (NOT the same as
    // pagination.total, which counts line-item rows since Daily Sheet is
    // one-row-per-item); items_count === pagination.total, kept as an
    // explicit field so the frontend stat card doesn't need to know that.
    invoice_count: number;
    client_count: number;
    staff_count: number;
    items_count: number;
    pending_payment_count: number;
    fully_paid_count: number;
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
    brand_ids?: string[];
    category_id?: string;
    category_ids?: string[];
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
    paid_amount: number;
    due_amount: number;
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
    category_ids?: string[];
    service_id?: string;
    service_ids?: string[];
    min_price?: number;
    max_price?: number;
    payment_method?: string;
    payment_methods?: string[];
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
    paid_amount: number;
    due_amount: number;
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
    staff_ids?: string[];
    item_types?: string[];
    payment_methods?: string[];
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface GstReportRow {
    sale_id: string;
    appointment_id: string | null;
    date: string;
    invoice_no: string;
    client_name: string | null;
    // Taxable-base breakdown by item type, summed from sale_items.taxable_amount
    // — service+product+package+membership always accounts for the full
    // taxable_amount below (those are the only item types that exist).
    service_amount: number;
    product_amount: number;
    package_amount: number;
    membership_amount: number;
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
    search?: string;
    brand_ids?: string[];
    category_ids?: string[];
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

export type RewardStatusFilter = "active" | "inactive";

export interface RewardPointsReportFilters {
    search?: string;
    // Scopes points_earned/points_redeemed/last_activity_at to ledger entries
    // in this range — points_available is always the live current balance,
    // never date-scoped (it's a snapshot, not a period aggregate).
    start_date?: string;
    end_date?: string;
    // 'active' = currently has a positive balance, 'inactive' = balance is 0.
    status?: RewardStatusFilter;
    points_available_min?: number;
    points_available_max?: number;
    points_redeemed_min?: number;
    points_redeemed_max?: number;
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
    // Clients with at least one reward-points ledger entry in the filtered
    // range (same scope as the rows themselves).
    active_reward_clients: number;
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
    as_of_date?: string;
    status?: string;
    balance_min?: number;
    balance_max?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

// ===============================
// Product Inventory Report (independent report API — POST /api/report/product-inventory)
// Reads products directly (brand/category joined for display names), with
// per-product sold-qty/revenue folded in from the same aggregate the
// existing /product-inventory-sales endpoint already computes. Never calls
// the Appointment API/service.
// ===============================

export interface ProductInventoryReportFilters {
    search?: string;
    category_id?: string;
    category_ids?: string[];
    brand_id?: string;
    brand_ids?: string[];
    stock_status?: "in_stock" | "low_stock" | "out_of_stock";
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ProductInventoryReportRow {
    product_id: string;
    product_name: string;
    category_name: string;
    brand_name: string;
    sku: string;
    date_added: string;
    current_stock: number;
    reorder_level: number;
    unit_cost: number;
    total_value: number;
    sales_qty: number;
    sales_revenue: number;
    status: "in_stock" | "low_stock" | "out_of_stock";
}

export interface ProductInventoryReportStats {
    total_products: number;
    total_stock_value: number;
    low_stock_items: number;
    out_of_stock_items: number;
}

export interface ProductInventoryReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ProductInventoryReportResponse {
    rows: ProductInventoryReportRow[];
    pagination: ProductInventoryReportPagination;
    stats: ProductInventoryReportStats;
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
    staff_ids?: string[];
    gender?: string;
    membership_status?: string;
    last_visit_from?: string;
    last_visit_to?: string;
    sort_by?: string;
    sort_dir?: "asc" | "desc";
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
    avg_rating?: number | null;
    review_count?: number;
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
// Customer Spend Segments Report (POST /api/report/customer-spend)
//
// Classifies clients as VIP / Regular / Low by how much they have spent, and
// reports how revenue is distributed across those bands. Distinct from the
// existing spend SORTING (Client Revenue's "Highest Revenue", Customer
// Frequency's "Most Spending"): sorting gives an ordering, this gives a
// label, per-segment counts, and each band's share of revenue — none of
// which exist anywhere else.
//
// Two owner-set thresholds drive the split; there is no sensible universal
// default, so they are request-scoped inputs in the same spirit as Lost
// Customers' lost_days.
//
// Zero-spend clients (registered, never purchased) ARE included and land in
// 'low' by design — hence the LEFT JOIN onto sales, matching Client Revenue
// and Customer Frequency rather than Lost Customers' INNER JOIN.
//
// Spend is SUM(sales.total_amount) WHERE status='completed', identical to
// the three sibling client reports so all four agree. Note this differs from
// clients.repository.ts's own spend figure, which additionally counts open
// partial payments — a client can therefore sit in a different band on the
// Clients page than in this report.
// ===============================

export type CustomerSpendSegment = "vip" | "regular" | "low";

export interface CustomerSpendReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    segments?: string[];
    // ₹ at or above which a client counts as VIP; ₹ below which they count as
    // Low. Clamped so low_max can never exceed vip_min (overlapping bands
    // would silently swallow the Regular segment).
    vip_min_spend?: number;
    low_max_spend?: number;
    // Row-level filter — clients with at least this many visits in the
    // filtered date range. Combines with every other filter (AND).
    min_visits?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface CustomerSpendReportRow {
    client_id: string | null;
    client_name: string;
    contact: string;
    spend_segment: CustomerSpendSegment;
    visits: number;
    total_spend: number;
    avg_ticket: number;
    first_visit: string | null;
    last_visit: string | null;
    days_since_last_visit: number | null;
}

export interface CustomerSpendReportStats {
    vip_clients: number;
    regular_clients: number;
    low_clients: number;
    total_revenue: number;
    // VIP revenue as a % of all revenue in the filtered set — the report's
    // headline number (87.5% on current dev data).
    vip_revenue_share: number;
}

export interface CustomerSpendReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface CustomerSpendReportResponse {
    rows: CustomerSpendReportRow[];
    pagination: CustomerSpendReportPagination;
    stats: CustomerSpendReportStats;
}

// ===============================
// Customer Frequency Report (independent report API —
// POST /api/report/customer-frequency)
// Reads clients/sales directly, never the Appointment API. One row per
// registered client, bucketed into New/Returning plus a customer_type
// segment (new/old/lost) derived from first_visit/last_visit against the
// selected date range — see _CUSTOMER_FREQUENCY_AGG for the exact rules.
// ===============================

export interface CustomerFrequencyReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    // Single-select segment/sort applied together, same convention as the
    // Commission Report's Status filter: 'most_frequent'/'least_frequent'
    // sort the table by visit count and 'most_spending'/'least_spending'
    // sort it by total spend, instead of bucketing it; 'new'/'old'/
    // 'lost' filter to that customer_type segment.
    customer_type?: "most_frequent" | "least_frequent" | "most_spending" | "least_spending" | "new" | "old" | "lost";
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface CustomerFrequencyReportRow {
    client_id: string | null;
    client_name: string;
    contact: string;
    visits: number;
    total_spend: number;
    first_visit: string | null;
    last_visit: string | null;
    // 'new' = first visit falls inside the selected date range; 'returning'
    // = client had at least one visit before the range started.
    visitor_type: "new" | "returning";
    // 'new'/'old'/'lost' per visitor_type + last_visit-vs-today, independent
    // of whichever customer_type filter value (if any) was applied.
    customer_type: "new" | "old" | "lost";
}

export interface CustomerFrequencyReportStats {
    total_clients: number;
    new_clients: number;
    returning_clients: number;
    lost_clients: number;
}

export interface CustomerFrequencyReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface CustomerFrequencyReportResponse {
    rows: CustomerFrequencyReportRow[];
    pagination: CustomerFrequencyReportPagination;
    stats: CustomerFrequencyReportStats;
}

// ===============================
// Service Frequency Report (POST /api/report/service-frequency)
//
// One row per CLIENT + SERVICE pair — "how often does this client come back
// for this particular service". Sits between the two existing halves:
// Service Sale is one row per sale line (flat, un-aggregated), while
// Customer Frequency / Lost Customers aggregate per client but are blind to
// which service was taken.
//
// Reads sale_items joined to sales/clients, never the Appointment API. Two
// deliberate choices:
//
//  1. s.status = 'completed', matching Customer Frequency and Lost Customers
//     rather than Service Sale's `<> 'draft'` — a "visit" in a frequency
//     report should mean a completed one. Consequence: totals do NOT tie
//     exactly to Service Sale (2 draft lines' worth on current data).
//  2. Grouped on si.item_id but displayed via COALESCE(sv.name, si.name):
//     si.name is a snapshot taken at sale time, so grouping on it would split
//     a renamed service into two rows.
//
// Walk-ins (sales with no client_id) and unbilled appointments are excluded
// by design — neither can be attributed to a client's service history.
// ===============================

export interface ServiceFrequencyReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    service_ids?: string[];
    category_ids?: string[];
    staff_ids?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ServiceFrequencyReportRow {
    client_id: string | null;
    client_name: string;
    contact: string;
    service_id: string | null;
    service_name: string;
    category_name: string;
    visits: number;
    total_qty: number;
    total_spend: number;
    first_visit: string | null;
    last_visit: string | null;
    days_since_last_visit: number;
}

export interface ServiceFrequencyReportStats {
    total_pairs: number;
    repeat_pairs: number;
    total_visits: number;
    total_revenue: number;
    avg_visits_per_pair: number;
}

export interface ServiceFrequencyReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ServiceFrequencyReportResponse {
    rows: ServiceFrequencyReportRow[];
    pagination: ServiceFrequencyReportPagination;
    stats: ServiceFrequencyReportStats;
}

// ===============================
// Lost Customers Report (independent report API — POST /api/report/lost-customers)
// Standalone report, separate from Customer Frequency's fixed 90-day "lost"
// bucket: the inactivity cutoff is user-configurable (lost_days), and
// start_date/end_date filter directly on last_visit (which past window of
// "went quiet" clients to show), not on first_visit like Customer Frequency's
// date range does.
// ===============================

export interface LostCustomersReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    // Days since last visit before a client counts as "lost". Defaults to 90
    // (same default Customer Frequency's fixed cutoff used) when omitted.
    lost_days?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface LostCustomersReportRow {
    client_id: string | null;
    client_name: string;
    contact: string;
    visits: number;
    total_spend: number;
    first_visit: string | null;
    last_visit: string | null;
    days_since_last_visit: number;
}

export interface LostCustomersReportStats {
    total_lost_clients: number;
    total_spend_when_active: number;
}

export interface LostCustomersReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface LostCustomersReportResponse {
    rows: LostCustomersReportRow[];
    pagination: LostCustomersReportPagination;
    stats: LostCustomersReportStats;
}

// ===============================
// Referral Report (independent report API — POST /api/report/referral)
// One row per REFERRED client (i.e. per clients.referred_by_client_id link),
// joined back to the referrer. Reads clients/sales/referral_ledger directly,
// never the Appointment API. "Reward Earned" comes from the referral_ledger
// payout row actually written for that referral (source_type =
// 'referral_payout', source_id = the referred client), so an un-triggered
// reward reads ₹0 rather than the configured amount.
// ===============================

export interface ReferralReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    // 'rewarded' | 'pending' — filters on the REFERRER's payout status
    // (clients.referral_reward_status on the referred client's row).
    reward_status?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ReferralReportRow {
    referred_client_id: string | null;
    referrer_client_id: string | null;
    referrer_name: string;
    referred_name: string;
    referral_date: string | null;
    first_visit: string | null;
    total_visits: number;
    revenue_generated: number;
    reward_earned: number;
    reward_status: "rewarded" | "pending";
    staff_name: string;
}

export interface ReferralReportStats {
    total_referrals: number;
    rewarded_referrals: number;
    total_revenue_generated: number;
    total_reward_earned: number;
}

export interface ReferralReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ReferralReportResponse {
    rows: ReferralReportRow[];
    pagination: ReferralReportPagination;
    stats: ReferralReportStats;
}

// ===============================
// Payment Collection Report (independent report API — POST /api/report/payment-collection)
//
// Reads appointments + payments directly, NOT sales. Two schema facts drive
// this and are easy to get wrong:
//
//  1. `sales` carries no due/paid/payment_status column at all, and a sales
//     row is only written once a bill is fully settled — a partially-paid
//     bill structurally has NO sales row (see the comment above
//     _UNBILLED_APPOINTMENT_ROWS_CTE). So dues can only come from payments.
//  2. payments has no sale_id; it links to appointments via appointment_id.
//
// payments.due_amount is a CUMULATIVE SNAPSHOT — each row stores the balance
// remaining as of that row, not an incremental charge. It must be read from
// the LATEST row per appointment; SUMming it across rows double-counts one
// debt (measured at 71% overstatement on real data, and it reports debt
// against bills the customer has already settled in full). paid_amount, by
// contrast, IS a per-row delta and is correctly SUMmed.
//
// Scope: only appointments that have at least one payment row appear, so
// every row is 'paid' or 'partial'; never-paid ("booked") appointments are
// excluded by the INNER JOIN LATERAL.
// ===============================

export interface PaymentCollectionReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    // 'paid' | 'partial' — derived from the latest payment row's due_amount,
    // not from sales.status.
    payment_statuses?: string[];
    payment_methods?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface PaymentCollectionReportRow {
    appointment_id: string | null;
    client_id: string | null;
    payment_date: string | null;
    customer_name: string;
    contact: string;
    invoice_number: string;
    total_amount: number;
    paid_amount: number;
    due_amount: number;
    payment_method: string;
    payment_status: "paid" | "partial";
    staff_name: string;
}

export interface PaymentCollectionReportStats {
    total_pending_amount: number;
    total_pending_transactions: number;
    total_customers_with_due: number;
    average_pending_amount: number;
    oldest_pending_payment_date: string | null;
    // Reconciliation context for the pending figures above — lets an owner
    // see collection rate rather than only the outstanding balance.
    total_billed: number;
    total_collected: number;
}

export interface PaymentCollectionReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

// Filter dropdown options, built from the salon's whole payment history
// rather than the current page of rows — otherwise a payment method that
// only appears on page 3 would be missing from the filter that finds it.
// Same convention as getSalesSummaryFiltersAvailable.
export interface PaymentCollectionFiltersAvailable {
    payment_methods: { id: string; label: string }[];
    staff: { id: string; label: string }[];
}

export interface PaymentCollectionReportResponse {
    rows: PaymentCollectionReportRow[];
    pagination: PaymentCollectionReportPagination;
    stats: PaymentCollectionReportStats;
    filters_available: PaymentCollectionFiltersAvailable;
}

// ===============================
// CASH MANAGEMENT REPORT
// One row per cash counter session (cash_management table) — opening/
// closing balance, cash revenue/expense collected while the counter was
// open, in-store cash counted at close, and the reconciliation difference.
// ===============================

export interface CashManagementReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    statuses?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface CashManagementReportRow {
    id: string;
    status: "open" | "closed";
    opening_balance: number;
    cash_revenue: number;
    cash_expense: number;
    closing_balance: number;
    in_store_cash: number | null;
    reconciliation_amount: number | null;
    remarks: string | null;
    opened_at: string | null;
    closed_at: string | null;
    opened_by: string;
    closed_by: string | null;
}

export interface CashManagementReportStats {
    total_opening_balance: number;
    total_cash_revenue: number;
    total_cash_expense: number;
    total_closing_balance: number;
    total_reconciliation_amount: number;
    total_sessions: number;
    open_sessions: number;
    closed_sessions: number;
}

export interface CashManagementReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface CashManagementFiltersAvailable {
    status: { id: string; label: string }[];
}

export interface CashManagementReportResponse {
    rows: CashManagementReportRow[];
    pagination: CashManagementReportPagination;
    stats: CashManagementReportStats;
    filters_available: CashManagementFiltersAvailable;
}

// ===============================
// Staff Sales Report (independent report API — POST /api/report/staff-sales)
// Reads directly from sales/sale_items/payments, one row per transaction,
// optionally filtered to one staff member. Commission is joined from
// commission_earned (keyed by sale_id + staff_id). Must never call the
// Appointment API/service.
// ===============================

export interface StaffSalesReportFilters {
    start_date?: string;
    end_date?: string;
    staff_id?: string;
    staff_ids?: string[];
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
    payment_mode?: string;
    payment_modes?: string[];
    item_type?: string;
    item_types?: string[];
    payment_status?: string;
    payment_statuses?: string[];
    sort?: "sales_desc" | "sales_asc";
}

export interface StaffSalesReportRow {
    id: string;
    // Resolved staff (see the sales_side/appt_side st.id join) — null on the
    // rare row where no staff could be resolved at all. Powers the Staff
    // Sales report's staff-name click-through to that staff's history.
    staff_id: string | null;
    staff_name: string;
    // True for synthetic rows sourced from a not-yet-billed appointment
    // (see _UNBILLED_APPOINTMENT_ROWS_CTE) — these have no real sales.id, so
    // the per-item drill-down (GET /api/report/sales-summary/:id) can't be
    // looked up for them.
    is_unbilled: boolean;
    client_name: string;
    client_phone: string;
    item_types: string;
    item_description: string;
    price: number;
    paid_amount: number;
    due_amount: number;
    commission_amount: number;
    payment_method: string | null;
    status: string;
    created_at: string;
}

export interface StaffSalesReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface StaffSalesReportStats {
    total_bill: number;
    total_sale: number;
    total_paid: number;
    total_due: number;
    total_commission: number;
    service_revenue: number;
    product_revenue: number;
    package_revenue: number;
    membership_revenue: number;
}

export interface StaffSalesReportResponse {
    rows: StaffSalesReportRow[];
    pagination: StaffSalesReportPagination;
    stats: StaffSalesReportStats;
    filters_available: { payment_modes: string[] };
}

// ===============================
// Staff Performance Report (independent report API —
// POST /api/report/staff-performance)
// One row per staff member — aggregates sale_items (grouped by the item's
// resolved staff) for per-type counts/revenue, and sales (grouped by the
// sale's own resolved staff) for collected/due, so a sale split across
// multiple staff never double-counts money collected. Must never call the
// Appointment API/service.
// ===============================

export interface StaffPerformanceReportFilters {
    start_date?: string;
    end_date?: string;
    staff_ids?: string[];
    branch_id?: string;
    payment_mode?: string;
    payment_modes?: string[];
    // Maps onto sales.status: 'completed' | 'partial' | 'cancelled' | 'refunded'.
    payment_status?: string;
    payment_statuses?: string[];
    item_type?: string;
    item_types?: string[];
    service_id?: string;
    product_id?: string;
    package_id?: string;
    package_ids?: string[];
    membership_id?: string;
    membership_ids?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface StaffPerformanceReportRow {
    staff_id: string;
    staff_name: string;
    staff_avatar: string | null;
    contact: string;
    invoice_count: number;
    service_count: number;
    service_revenue: number;
    product_count: number;
    product_revenue: number;
    package_count: number;
    package_revenue: number;
    membership_count: number;
    membership_revenue: number;
    total_revenue: number;
    avg_bill: number;
    commission: number;
    collected: number;
    due: number;
}

export interface StaffPerformanceReportStats {
    total_staff: number;
    total_revenue: number;
    service_revenue: number;
    product_revenue: number;
    package_revenue: number;
    membership_revenue: number;
    total_commission: number;
    avg_revenue_per_staff: number;
}

export interface StaffPerformanceFilterOption {
    id: string;
    label: string;
}

export interface StaffPerformanceFiltersAvailable {
    staff: StaffPerformanceFilterOption[];
    branches: StaffPerformanceFilterOption[];
    payment_modes: string[];
    services: StaffPerformanceFilterOption[];
    products: StaffPerformanceFilterOption[];
    packages: StaffPerformanceFilterOption[];
    memberships: StaffPerformanceFilterOption[];
}

export interface StaffPerformanceReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface StaffPerformanceReportResponse {
    rows: StaffPerformanceReportRow[];
    pagination: StaffPerformanceReportPagination;
    stats: StaffPerformanceReportStats;
    filters_available: StaffPerformanceFiltersAvailable;
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
    staff_ids?: string[];
    // Matches against staff name AND the current tab's item name (service/
    // product/membership/package) — scoped to whichever item_type is active,
    // not a cross-item-type search.
    search?: string;
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
    package_names?: string[];
    package_status?: string;
    package_statuses?: string[];
    payment_status?: string;
    payment_statuses?: string[];
    payment_method?: string;
    payment_methods?: string[];
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
    expiry_date: string | null;
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

// client_packages.status is only ever persisted as 'Active' or 'Completed'
// (see client-packages.repository.ts::completeSession(), which already
// auto-flips it to 'Completed' the moment every service's sessions are
// used up) — "Expired" is derived here from expiry_date vs now(), same
// convention as the Membership Sale report's status computation.
// 'expiring_soon' = still active, but within _PACKAGE_EXPIRING_SOON_DAYS of
// its expiry_date. Sits between 'ongoing' and 'expired' so a salon can chase
// clients to use sessions they've already paid for.
export type PackageHistoryStatus = "ongoing" | "expiring_soon" | "complete" | "expired";

export interface PackageHistoryReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    package_name?: string;
    package_names?: string[];
    service_name?: string;
    service_names?: string[];
    staff_ids?: string[];
    status?: PackageHistoryStatus;
    statuses?: string[];
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
    // This service line's own remaining sessions (total - completed) — a
    // live snapshot of current state, not a value frozen at the time this
    // particular session was logged.
    remaining_sessions: number;
    staff: string;
    // The parent package's expiry date as 'YYYY-MM-DD' text (never a bare
    // date — see the TO_CHAR note in the rows query).
    expiry_date: string | null;
    status: PackageHistoryStatus;
}

export interface PackageHistoryReportStats {
    total_sessions: number;
    completed_sessions: number;
    remaining_sessions: number;
    ongoing_packages: number;
    expiring_soon_packages: number;
    completed_packages: number;
    expired_packages: number;
}

export interface PackageHistoryReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface PackageHistoryFiltersAvailable {
    packages: string[];
    services: string[];
}

export interface PackageHistoryReportResponse {
    rows: PackageHistoryReportRow[];
    pagination: PackageHistoryReportPagination;
    stats: PackageHistoryReportStats;
    filters_available: PackageHistoryFiltersAvailable;
}

// ===============================
// Membership History Report (POST /api/report/membership-history)
//
// One row per membership benefit REDEMPTION, read from membership_usage_log —
// the membership counterpart to Package History (which reads
// client_package_session_history). Membership Sale answers "who bought what";
// this answers "who used what, when, on which service, and what's left".
//
// THE trap: membership_usage_log stores structurally different kinds of row in
// one table, discriminated only by `notes`:
//   notes IS NULL              -> wallet spend  (₹ drawn from a value balance)
//   notes = 'membership_discount' -> discount given (% off the bill)
//   anything else              -> a consumed session (sessions_consumed > 0)
// Wallet rows carry amount_deducted with sessions_consumed = 0; session rows
// are the reverse. Summing amount_deducted across kinds adds money actually
// spent to money never charged, so the two are always reported separately.
// The rest of the codebase depends on the same discriminator — see
// client-memberships.repository.ts::getWalletUsedForAppointment.
//
// Also note the table has NO salon_id: tenant scoping comes from the
// INNER JOIN onto client_memberships.
// ===============================

// How the benefit was taken off this bill. NOT a membership type — the three
// membership pricing models are 'value' | 'percentage' | 'loyalty'
// (MembershipPricingType); there is no session-based membership, sessions
// being a package concept. Loyalty writes no ledger row at all, so it can
// never appear here; 'other' is the catch-all rather than an invented type.
export type MembershipBenefitType = "wallet" | "discount" | "loyalty" | "other";

export interface MembershipHistoryReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    membership_names?: string[];
    benefit_types?: string[];
    // 'value' | 'percentage' | 'loyalty' — the membership's pricing model.
    pricing_types?: string[];
    staff_ids?: string[];
    statuses?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface MembershipHistoryReportRow {
    date: string | null;
    client_id: string | null;
    client_name: string;
    membership_name: string;
    // The membership's pricing model: 'value' | 'percentage' | 'loyalty'.
    membership_type: string;
    service_name: string;
    benefit_type: MembershipBenefitType;
    // ₹ taken off this bill by the membership. For a session-type row this is
    // 0 and sessions_consumed carries the meaning instead.
    amount_deducted: number;
    // The membership's balance immediately AFTER this redemption — a
    // point-in-time snapshot stored per row, not a live lookup.
    remaining_balance: number | null;
    sessions_consumed: number;
    staff: string;
    expiry_date: string | null;
    // Reuses MemberSaleStatus's vocabulary via _MEMBER_STATUS_EXPR so this
    // report and Membership Sale can never disagree about one membership.
    status: string;
}

export interface MembershipHistoryReportStats {
    total_redemptions: number;
    // Kept apart deliberately — see the banner comment above.
    total_wallet_used: number;
    total_discount_given: number;
    // Loyalty benefit, reconstructed from payments.membership_discount_used
    // minus what the usage log explains — loyalty writes no ledger row.
    total_loyalty_given: number;
    active_memberships: number;
    expiry_soon_memberships: number;
    exhausted_memberships: number;
}

export interface MembershipHistoryReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface MembershipHistoryFiltersAvailable {
    memberships: string[];
    services: string[];
}

export interface MembershipHistoryReportResponse {
    rows: MembershipHistoryReportRow[];
    pagination: MembershipHistoryReportPagination;
    stats: MembershipHistoryReportStats;
    filters_available: MembershipHistoryFiltersAvailable;
}

// ===============================
// Member Sale Report (independent report API — POST /api/report/member-sale)
// Reads directly from client_memberships, one row per membership sale. Never
// touches the Appointment API.
// ===============================

// Computed status vocabulary — client_memberships.status is only ever
// persisted as 'active' or 'exhausted' (nothing ever writes 'expired'), so
// "Expired"/"Expiry Soon" are derived here from expires_at vs now(), and
// "Complete" replaces the raw 'exhausted' value for display.
export type MemberSaleStatus = "active" | "expiry_soon" | "expired" | "complete";

export interface MemberSaleReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    status?: MemberSaleStatus;
    statuses?: string[];
    membership_id?: string;
    membership_ids?: string[];
    staff_ids?: string[];
    // 'value' (Flat Value) | 'percentage' | 'loyalty' — mirrors
    // client_memberships.pricing_type as snapshotted at sale time.
    pricing_type?: string;
    pricing_types?: string[];
    price_min?: number;
    price_max?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface MemberSaleReportRow {
    id: string;
    client_id: string | null;
    purchased_at: string;
    invoice_number: string | null;
    client_name: string;
    staff_name: string;
    membership_name: string;
    pricing_type: string | null;
    // Pre-formatted by the row mapper: "₹500" for a flat-value membership,
    // "10%" for a percentage one — the frontend still re-renders the numeric
    // case through useCurrency for the configured currency symbol.
    value_amount: number | null;
    extra_benefits: string;
    price_paid: number;
    payment_method: string | null;
    status: MemberSaleStatus;
}

export interface MemberSaleReportStats {
    memberships_sold: number;
    total_revenue: number;
    active_memberships: number;
    expiry_soon_memberships: number;
    expired_memberships: number;
    completed_memberships: number;
}

export interface MemberSaleReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface MemberSaleFilterOption {
    id: string;
    label: string;
}

export interface MemberSaleFiltersAvailable {
    memberships: MemberSaleFilterOption[];
    staff: MemberSaleFilterOption[];
    pricing_types: string[];
}

export interface MemberSaleReportResponse {
    rows: MemberSaleReportRow[];
    pagination: MemberSaleReportPagination;
    stats: MemberSaleReportStats;
    filters_available: MemberSaleFiltersAvailable;
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
    search?: string;
    payment_methods?: string[];
    staff_ids?: string[];
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
    // Combined item names/types for the whole bill (STRING_AGG'd across
    // every service/product/package/membership on the appointment), not a
    // single item — a bill can span more than one type.
    item_name: string;
    item_type: string;
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

// ===============================
// Upcoming Appointments Report (independent report API —
// POST /api/report/upcoming-appointments)
// Same appointments-table shape as Appointment Detail above, but scoped to
// future bookings only (scheduled_at in the future, status still 'booked') —
// front-desk view of what's coming up rather than a historical ledger.
// Appointment "type" (Regular / Package Service / Membership Service) is
// derived from package/membership coverage on the appointment — there is no
// dedicated column. Package coverage can come from either package_items[]
// (a new package sold on this same visit) or services[].client_package_id /
// is_package_service (an existing package's session being redeemed) — see
// the comment above getUpcomingAppointmentsReport in reports.repository.ts.
// ===============================

export interface UpcomingAppointmentsReportFilters {
    from?: string;
    to?: string;
    search?: string;
    client_ids?: string[];
    staff_ids?: string[];
    service_ids?: string[];
    package_ids?: string[];
    statuses?: string[];
    appointment_types?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface UpcomingAppointmentsReportRow {
    id: string;
    appointment_date: string;
    time: string;
    client_name: string | null;
    mobile_number: string | null;
    service_name: string;
    package_name: string;
    staff_name: string | null;
    appointment_status: string;
    appointment_type: string;
    // Payment-source preview, same "Description" column Sales Summary shows
    // (there payment_method/payment_reference-derived; here — since an
    // upcoming appointment has no sale/payment row yet — derived from the
    // same package/membership coverage appointment_type above already
    // reads). "—" for a Regular appointment: how it'll actually be paid
    // isn't known until checkout.
    description: string;
}

export interface UpcomingAppointmentsReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface UpcomingAppointmentsFilterOption {
    id: string;
    label: string;
}

export interface UpcomingAppointmentsFiltersAvailable {
    clients: UpcomingAppointmentsFilterOption[];
    staff: UpcomingAppointmentsFilterOption[];
    services: UpcomingAppointmentsFilterOption[];
    packages: UpcomingAppointmentsFilterOption[];
}

export interface UpcomingAppointmentsReportResponse {
    rows: UpcomingAppointmentsReportRow[];
    pagination: UpcomingAppointmentsReportPagination;
    filters_available: UpcomingAppointmentsFiltersAvailable;
}

// ===============================
// WA Marketing Campaign Report (independent report API — POST /api/report/wa-campaign)
// Reads wa_campaigns directly (template joined by name, per-contact status
// counts aggregated live from wa_campaign_contacts — the campaign's own
// sent_count/delivered_count/etc columns are unmaintained/stale, never
// written to after insert, so they are NOT the source of truth here).
// ===============================

export interface WaCampaignReportFilters {
    search?: string;
    statuses?: string[];
    template_ids?: string[];
    date_from?: string;
    date_to?: string;
    delivery_bucket?: "high" | "medium" | "low" | "none";
    read_bucket?: "high" | "medium" | "low" | "none";
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface WaCampaignReportRow {
    id: string;
    name: string;
    template_id: string | null;
    template_name: string;
    status: string;
    created_at: string;
    total_contacts: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    blocked: number;
}

export interface WaCampaignReportStats {
    total_campaigns: number;
    total_contacts: number;
    total_sent: number;
    total_delivered: number;
    total_read: number;
    total_failed: number;
    total_blocked: number;
    avg_delivery_rate: number;
    avg_read_rate: number;
}

export interface WaCampaignFilterOption { id: string; label: string; }

export interface WaCampaignFiltersAvailable {
    templates: WaCampaignFilterOption[];
}

export interface WaCampaignReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface WaCampaignReportResponse {
    rows: WaCampaignReportRow[];
    pagination: WaCampaignReportPagination;
    stats: WaCampaignReportStats;
    filters_available: WaCampaignFiltersAvailable;
}

// ===============================
// Open Rate Report (independent report API — POST /api/report/open-rate)
// Campaign engagement, sharing the WA_*_COUNT state definitions in
// reports.repository.ts with the WA Marketing Campaign report above.
//
// open_rate is opened / DELIVERED (never / sent): an undelivered message had
// no chance of being opened, so including it would understate engagement.
// Failed and blocked messages are therefore excluded from the denominator by
// construction — they never reach a 'DELIVERED'/'READ' state.
//
// `channel` is always 'whatsapp' today. The generic campaigns /
// campaign_recipients tables that would carry SMS/Email exist but hold no
// rows and nothing writes to them.
// ===============================

export type OpenRateChannel = "whatsapp" | "sms" | "email";

export interface OpenRateReportFilters {
    search?: string;
    campaign_ids?: string[];
    /** Message-level states; used as an EXISTS filter on campaigns, never to
     *  narrow the rows the rates are computed from. */
    message_statuses?: string[];
    campaign_statuses?: string[];
    channels?: OpenRateChannel[];
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
    is_export?: boolean;
    sort_by?: string;
    sort_dir?: "asc" | "desc";
}

export interface OpenRateReportRow {
    id: string;
    name: string;
    template_name: string;
    status: string;
    channel: string;
    created_at: string;
    total_contacts: number;
    sent: number;
    delivered: number;
    opened: number;
    failed: number;
    blocked: number;
    /** Percentage 0-100, already guarded against a zero denominator. */
    open_rate: number;
}

export interface OpenRateReportStats {
    total_campaigns: number;
    total_recipients: number;
    total_sent: number;
    total_delivered: number;
    total_opened: number;
    total_failed: number;
    total_blocked: number;
    open_rate: number;
}

export interface OpenRateTrendPoint {
    /** YYYY-MM-DD, cohorted by send date — see getOpenRateTrend. */
    day: string;
    sent: number;
    delivered: number;
    opened: number;
    open_rate: number;
}

export interface OpenRateCustomerRow {
    id: string;
    name: string;
    phone: string;
    status: string;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    error_message: string | null;
}

export interface OpenRateCampaignDetail {
    id: string;
    name: string;
    status: string;
    channel: string;
    created_at: string;
    template_name: string;
    message_body: string;
    total_contacts: number;
    sent: number;
    delivered: number;
    opened: number;
    failed: number;
    blocked: number;
    open_rate: number;
    customers: OpenRateCustomerRow[];
    customers_pagination: WaCampaignReportPagination;
}

export interface OpenRateFilterOption { id: string; label: string; }

export interface OpenRateFiltersAvailable {
    campaigns: OpenRateFilterOption[];
}

// ===============================
// Reply Rate Report (independent report API — POST /api/report/reply-rate)
// Shares filters and state definitions with the Open Rate report.
//
// A reply is an INBOUND WhatsApp message from the recipient's number arriving
// within 24h of the campaign reaching them (WA_REPLY_WINDOW in
// reports.repository.ts) — nothing links a message to a campaign directly, so
// phone + timing is the only available attribution.
//
// reply_rate is replied / SENT (not / delivered, unlike open_rate): it's the
// figure staff asked for, and delivery receipts are often missing here, which
// would otherwise let replies exceed the denominator.
// ===============================

export interface ReplyRateReportRow {
    id: string;
    name: string;
    template_name: string;
    status: string;
    channel: string;
    created_at: string;
    total_contacts: number;
    /** Every send ATTEMPT, including failed/blocked — matches the other
     *  campaign reports' `sent` so the three agree per campaign. */
    sent: number;
    /** Attempts that actually went out (SENT/DELIVERED/READ). This, not
     *  `sent`, is the reply-rate denominator — a failed message can't be
     *  replied to. See WA_REACHED_COUNT. */
    reached: number;
    delivered: number;
    opened: number;
    failed: number;
    replied: number;
    reply_rate: number;
}

export interface ReplyRateReportStats {
    total_campaigns: number;
    total_sent: number;
    /** Reply-rate denominator — see ReplyRateReportRow.reached. */
    total_reached: number;
    total_delivered: number;
    total_opened: number;
    total_replied: number;
    total_failed: number;
    reply_rate: number;
}

export interface ReplyRateCustomerRow {
    id: string;
    name: string;
    phone: string;
    status: string;
    sent_at: string | null;
    delivered_at: string | null;
    read_at: string | null;
    /** First in-window inbound message; null when they never replied. */
    first_reply_at: string | null;
}

export interface ReplyRateCampaignDetail {
    id: string;
    name: string;
    status: string;
    channel: string;
    created_at: string;
    template_name: string;
    message_body: string;
    total_contacts: number;
    /** Every send ATTEMPT, including failed/blocked — matches the other
     *  campaign reports' `sent` so the three agree per campaign. */
    sent: number;
    /** Attempts that actually went out (SENT/DELIVERED/READ). This, not
     *  `sent`, is the reply-rate denominator — a failed message can't be
     *  replied to. See WA_REACHED_COUNT. */
    reached: number;
    delivered: number;
    opened: number;
    failed: number;
    replied: number;
    reply_rate: number;
    customers: ReplyRateCustomerRow[];
    customers_pagination: WaCampaignReportPagination;
}

export interface ReplyRateReportResponse {
    rows: ReplyRateReportRow[];
    pagination: WaCampaignReportPagination;
    stats: ReplyRateReportStats;
    filters_available: OpenRateFiltersAvailable;
}

export interface OpenRateReportResponse {
    rows: OpenRateReportRow[];
    pagination: WaCampaignReportPagination;
    stats: OpenRateReportStats;
    filters_available: OpenRateFiltersAvailable;
    /** Only populated if a caller asks for it — the report itself has no
     *  charts, so the service skips the trend query entirely. */
    trend?: OpenRateTrendPoint[];
}

// ===============================
// Client Rating Report (independent report API — POST /api/report/client-rating)
// Reads directly from the reviews table (JOIN clients/staff), one row per
// review. Only is_visible = true reviews are included by default, matching
// what the reviews module treats as client-facing/visible. Never calls into
// the reviews module's service/repository, and never touches the
// Appointment API/service.
// ===============================

export interface ClientRatingReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    min_rating?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface ClientRatingReportRow {
    client_id: string | null;
    client_name: string;
    contact: string;
    staff_id: string | null;
    staff_name: string;
    rating: number;
    staff_rating: number | null;
    service_rating: number | null;
    ambience_rating: number | null;
    review_text: string | null;
    review_date: string;
    source: string;
    total_spend?: number;
    visits?: number;
}

export interface ClientRatingReportStats {
    total_reviews: number;
    average_rating: number;
    positive_reviews: number;
    negative_reviews: number;
}

export interface ClientRatingReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

// ===============================
// Rebooking Rate Report (independent report API — POST /api/report/rebooking-rate)
// Per staff member: of the completed visits they served, what share of
// clients came back for another completed visit (with any staff) within a
// user-entered day window. Reads sales/sale_items/clients directly, never
// the Appointment API.
// ===============================

export interface RebookingRateReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    // Rebooking window in days — manually entered by the user, no preset
    // default in the UI, but the backend still falls back to 45 if omitted.
    rebooking_days?: number;
    page?: number;
    limit?: number;
    is_export?: boolean;
    sort?: "rate_desc" | "rate_asc";
}

export interface RebookingRateReportRow {
    staff_id: string;
    staff_name: string;
    total_visits: number;
    rebooked_visits: number;
    rebooking_rate: number;
}

export interface RebookingRateReportStats {
    total_visits: number;
    rebooked_visits: number;
    overall_rebooking_rate: number;
    staff_count: number;
}

export interface RebookingRateReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface RebookingRateReportResponse {
    rows: RebookingRateReportRow[];
    pagination: RebookingRateReportPagination;
    stats: RebookingRateReportStats;
}

// ===============================
// Payroll History Report (independent report API —
// POST /api/report/payroll-history)
// Reads directly from payroll_entries joined to staff, one row per payroll
// entry (staff x period). Never touches the Appointment API.
// ===============================

export interface PayrollHistoryReportFilters {
    start_date?: string;
    end_date?: string;
    search?: string;
    staff_ids?: string[];
    payment_status?: string;
    payment_statuses?: string[];
    payment_method?: string;
    payment_methods?: string[];
    page?: number;
    limit?: number;
    is_export?: boolean;
}

export interface PayrollHistoryReportRow {
    id: string;
    staff_id: string;
    staff_name: string;
    staff_designation: string | null;
    period_type: string;
    period_start: string;
    period_end: string;
    base_salary: number;
    commission: number;
    tips: number;
    bonus: number;
    salary_advance: number;
    deductions: number;
    net_pay: number;
    paid_amount: number;
    pending_amount: number;
    payment_status: string;
    payment_method: string | null;
    payment_date: string | null;
}

export interface PayrollHistoryReportStats {
    total_entries: number;
    total_net_payroll: number;
    total_paid: number;
    total_pending: number;
}

export interface PayrollHistoryReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface PayrollHistoryFilterOption {
    id: string;
    label: string;
}

export interface PayrollHistoryReportResponse {
    rows: PayrollHistoryReportRow[];
    pagination: PayrollHistoryReportPagination;
    stats: PayrollHistoryReportStats;
    filters_available: {
        staff: PayrollHistoryFilterOption[];
    };
}

export interface ClientRatingReportResponse {
    rows: ClientRatingReportRow[];
    pagination: ClientRatingReportPagination;
    stats: ClientRatingReportStats;
}
