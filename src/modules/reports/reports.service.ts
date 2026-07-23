import { reportsRepository } from "./reports.repository";
import {
    SalesSummaryReportFilters,
    SalesSummaryReportResponse,
    SaleDetailResponse,
    DailySheetReportFilters,
    DailySheetReportResponse,
    ProductRetailReportFilters,
    ProductRetailReportResponse,
    ServiceSaleReportFilters,
    ServiceSaleReportResponse,
    GstReportFilters,
    GstReportResponse,
    ProductMarginReportFilters,
    ProductMarginReportResponse,
    RewardPointsReportFilters,
    RewardPointsReportResponse,
    EwalletReportFilters,
    EwalletReportResponse,
    ClientRevenueReportFilters,
    ClientRevenueReportResponse,
    StaffSalesReportFilters,
    StaffSalesReportResponse,
    StaffItemSalesReportFilters,
    StaffItemSalesReportResponse,
    PackageSaleReportFilters,
    PackageSaleReportResponse,
    PackageHistoryReportFilters,
    PackageHistoryReportResponse,
    MemberSaleReportFilters,
    MemberSaleReportResponse,
    AppointmentDetailReportFilters,
    AppointmentDetailReportResponse,
} from "./reports.types";

// ======================================================
// SALES SUMMARY REPORT (independent report API)
// ======================================================

export const reportsService = {

async getSalesSummaryReport(
    salonId: string,
    filters: SalesSummaryReportFilters
): Promise<SalesSummaryReportResponse> {
    const [statsRaw, rowsResult] = await Promise.all([
        reportsRepository.getSalesSummaryReportStats(salonId, filters),
        reportsRepository.getSalesSummaryReportRows(salonId, filters),
    ]);

    const bill_average = statsRaw.total_bill > 0
        ? statsRaw.total_sale / statsRaw.total_bill
        : 0;

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats: { ...statsRaw, bill_average },
    };
},

async getSaleDetail(salonId: string, saleId: string): Promise<SaleDetailResponse> {
    return reportsRepository.getSaleDetail(salonId, saleId);
},

// ======================================================
// DAILY SHEET REPORT (independent report API)
// ======================================================

async getDailySheetReport(
    salonId: string,
    filters: DailySheetReportFilters
): Promise<DailySheetReportResponse> {
    const [result, filtersAvailable] = await Promise.all([
        reportsRepository.getDailySheetReport(salonId, filters),
        reportsRepository.getDailySheetFiltersAvailable(salonId),
    ]);
    return {
        rows: result.items,
        pagination: result.pagination,
        total_amount: result.total_amount,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// PRODUCT RETAIL REPORT (independent report API)
// ======================================================

async getProductRetailReport(
    salonId: string,
    filters: ProductRetailReportFilters
): Promise<ProductRetailReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getProductRetailReportStats(salonId, filters),
        reportsRepository.getProductRetailReportRows(salonId, filters),
        reportsRepository.getProductRetailFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// SERVICE SALE REPORT (independent report API)
// ======================================================

async getServiceSaleReport(
    salonId: string,
    filters: ServiceSaleReportFilters
): Promise<ServiceSaleReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getServiceSaleReportStats(salonId, filters),
        reportsRepository.getServiceSaleReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// GST / TAXES REPORT (independent report API)
// ======================================================

async getGstReport(
    salonId: string,
    filters: GstReportFilters
): Promise<GstReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getGstReportStats(salonId, filters),
        reportsRepository.getGstReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// PRODUCT MARGIN REPORT (independent report API)
// ======================================================

async getProductMarginReport(
    salonId: string,
    filters: ProductMarginReportFilters
): Promise<ProductMarginReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getProductMarginReportStats(salonId, filters),
        reportsRepository.getProductMarginReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// REWARD POINTS REPORT (independent report API)
// ======================================================

async getRewardPointsReport(
    salonId: string,
    filters: RewardPointsReportFilters
): Promise<RewardPointsReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getRewardPointsReportStats(salonId, filters),
        reportsRepository.getRewardPointsReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// E-WALLET REPORT (independent report API)
// ======================================================

async getEwalletReport(
    salonId: string,
    filters: EwalletReportFilters
): Promise<EwalletReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getEwalletReportStats(salonId, filters),
        reportsRepository.getEwalletReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// CLIENT REVENUE REPORT (independent report API)
// ======================================================

async getClientRevenueReport(
    salonId: string,
    filters: ClientRevenueReportFilters
): Promise<ClientRevenueReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getClientRevenueReportStats(salonId, filters),
        reportsRepository.getClientRevenueReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// STAFF SALES REPORT (independent report API)
// ======================================================

async getStaffSalesReport(
    salonId: string,
    filters: StaffSalesReportFilters
): Promise<StaffSalesReportResponse> {
    const rows = await reportsRepository.getStaffSalesReport(salonId, filters);
    return { rows };
},

// ======================================================
// STAFF ITEM SALES REPORT (independent report API)
// ======================================================

async getStaffItemSalesReport(
    salonId: string,
    filters: StaffItemSalesReportFilters
): Promise<StaffItemSalesReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getStaffItemSalesReportStats(salonId, filters),
        reportsRepository.getStaffItemSalesReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// PACKAGE SALE REPORT (independent report API)
// ======================================================

async getPackageSaleReport(
    salonId: string,
    filters: PackageSaleReportFilters
): Promise<PackageSaleReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getPackageSaleReportStats(salonId, filters),
        reportsRepository.getPackageSaleReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// ======================================================

async getPackageHistoryReport(
    salonId: string,
    filters: PackageHistoryReportFilters
): Promise<PackageHistoryReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getPackageHistoryReportStats(salonId, filters),
        reportsRepository.getPackageHistoryReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// MEMBER SALE REPORT (independent report API)
// ======================================================

async getMemberSaleReport(
    salonId: string,
    filters: MemberSaleReportFilters
): Promise<MemberSaleReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getMemberSaleReportStats(salonId, filters),
        reportsRepository.getMemberSaleReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// APPOINTMENT DETAIL REPORT (independent report API)
// ======================================================

async getAppointmentDetailReport(
    salonId: string,
    filters: AppointmentDetailReportFilters
): Promise<AppointmentDetailReportResponse> {
    const result = await reportsRepository.getAppointmentDetailReport(salonId, filters);
    return {
        rows: result.items,
        pagination: result.pagination,
    };
},

};
