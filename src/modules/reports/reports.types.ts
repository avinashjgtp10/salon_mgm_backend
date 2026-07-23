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
    page?: number;
    limit?: number;
    is_export?: boolean; // bypasses the page-size cap for CSV export
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
    staff_id?: string;
    search?: string;
    page?: number;
    limit?: number;
    is_export?: boolean; // bypasses the page-size cap for CSV export
}

export interface DailySheetReportRow {
    appointment_id: string | null;
    sale_id: string;
    time: string;
    ticket_no: string;
    client_name: string | null;
    service_id: string | null;
    service: string;
    staff_id: string | null;
    staff: string | null;
    amount: number;
    payment_method: string | null;
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
}

export interface DailySheetReportResponse {
    rows: DailySheetReportRow[];
    pagination: DailySheetReportPagination;
    total_amount: number;
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
    product_id: string | null;
    product_name: string;
    quantity: number;
    price: number;
    total: number;
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
    filters_available: { products: ProductRetailFilterOption[] };
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
    staff_id?: string;
    search?: string;
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
    price: number;
}

export interface ServiceSaleReportStats {
    services_sold: number;
    total_revenue: number;
    avg_ticket: number;
    unique_services: number;
}

export interface ServiceSaleReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface ServiceSaleReportResponse {
    rows: ServiceSaleReportRow[];
    pagination: ServiceSaleReportPagination;
    stats: ServiceSaleReportStats;
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
}

export interface PackageSaleReportStats {
    packages_sold: number;
    total_sale_value: number;
    total_received: number;
    unique_packages: number;
}

export interface PackageSaleReportPagination {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}

export interface PackageSaleReportResponse {
    rows: PackageSaleReportRow[];
    pagination: PackageSaleReportPagination;
    stats: PackageSaleReportStats;
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
