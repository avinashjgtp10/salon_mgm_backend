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


