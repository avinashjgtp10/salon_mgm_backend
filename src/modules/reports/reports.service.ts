import { reportsRepository } from "./reports.repository";
import {
    resolveDateRange,
    round2,
    safeDiv,
    toNum,
} from "./reports.revenue.helpers";

import {
    CategoryTotalsRow,
    RevenueCategoryTotals,
    SalesSummaryData,
    SalesSummaryQuery,
    BalanceReceivedReportData,
    BalanceReceivedReportFilters,
    CouponRedemptionReportData,
    DayWiseReportData,
    DayWiseReportFilters,
    TopItemRow,
    TopMembershipSaleItem,
    TopPackageSaleItem,
    TopProductSaleItem,
    TopServiceSaleItem,
} from "./reports.types";

const CATEGORY_FIELD: Record<
    string,
    keyof RevenueCategoryTotals
> = {
    service: "serviceNetSale",
    product: "productNetSale",
    package: "packageNetSale",
    membership: "membershipNetSale",
    gift_card: "giftCardNetSale",
};





/**
 * Builds Summary Cards
 */
function buildCategoryTotals(
    rows: CategoryTotalsRow[]
) {

    const totals: RevenueCategoryTotals = {

        grossSale: 0,

        serviceNetSale: 0,

        productNetSale: 0,

        packageNetSale: 0,

        membershipNetSale: 0,

        giftCardNetSale: 0,

    };

    let serviceQty = 0;

    let itemDiscount = 0;

    for (const row of rows) {

        const gross = toNum(row.gross);

        const net = toNum(row.net);

        const qty = toNum(row.qty);

        totals.grossSale += gross;

        itemDiscount += (gross - net);

        const field = CATEGORY_FIELD[row.item_type];

        if (field) {

            totals[field] += net;

        }

        if (row.item_type === "service") {

            serviceQty += qty;

        }

    }

    totals.grossSale = round2(totals.grossSale);

    totals.serviceNetSale = round2(totals.serviceNetSale);

    totals.productNetSale = round2(totals.productNetSale);

    totals.packageNetSale = round2(totals.packageNetSale);

    totals.membershipNetSale = round2(totals.membershipNetSale);

    totals.giftCardNetSale = round2(totals.giftCardNetSale);

    return {

        totals,

        serviceQty,

        itemDiscount: round2(itemDiscount),

    };

}

/**
 * -------------------------------
 * Top Service Mapping
 * -------------------------------
 */

const mapTopServices = (
    rows: TopItemRow[]
): TopServiceSaleItem[] => {

    return rows.map(row => ({

        id: row.id ?? "",

        serviceName: row.name,

        quantitySold: toNum(row.qty),

        revenue: round2(
            toNum(row.revenue)
        ),

    }));

};

/**
 * -------------------------------
 * Top Product Mapping
 * -------------------------------
 */

const mapTopProducts = (
    rows: TopItemRow[]
): TopProductSaleItem[] => {

    return rows.map(row => ({

        id: row.id ?? "",

        productName: row.name,

        quantitySold: toNum(row.qty),

        revenue: round2(
            toNum(row.revenue)
        ),

    }));

};

/**
 * -------------------------------
 * Top Membership Mapping
 * -------------------------------
 */

const mapTopMemberships = (
    rows: TopItemRow[]
): TopMembershipSaleItem[] => {

    return rows.map(row => ({

        id: row.id ?? "",

        membershipName: row.name,

        count: toNum(row.qty),

        revenue: round2(
            toNum(row.revenue)
        ),

    }));

};

/**
 * -------------------------------
 * Top Package Mapping
 * -------------------------------
 */

const mapTopPackages = (
    rows: TopItemRow[]
): TopPackageSaleItem[] => {

    return rows.map(row => ({

        id: row.id ?? "",

        packageName: row.name,

        count: toNum(row.qty),

        revenue: round2(
            toNum(row.revenue)
        ),

    }));




};


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
    ProductInventoryReportFilters,
    ProductInventoryReportResponse,
    ClientRevenueReportFilters,
    ClientRevenueReportResponse,
    StaffSalesReportFilters,
    StaffSalesReportResponse,
    StaffPerformanceReportFilters,
    StaffPerformanceReportResponse,
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
    WaCampaignReportFilters,
    WaCampaignReportResponse,
} from "./reports.types";

// ======================================================
// LEGACY REPORTS (pre-existing GET-based reports module)
// Used by legacyReports.routes.ts (/api/v1/reports/*) — kept alongside the
// newer independent POST /api/report/* methods below.
// ======================================================

export const reportsService = {

// ======================================================
// SERVICE REVENUE REPORT
// ======================================================
async getServiceRevenue(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    const [
      cards,
      revenueTrend,
      categoryRevenue,
      topServices,
      staffRevenue,
      analytics,
      table,
    ] = await Promise.all([
      reportsRepository.getServiceRevenueCards(
        salonId,
        filters
      ),

      reportsRepository.getServiceRevenueTrend(
        salonId,
        filters
      ),

      reportsRepository.getServiceCategoryRevenue(
        salonId,
        filters
      ),

      reportsRepository.getTopRevenueServices(
        salonId,
        filters
      ),

      reportsRepository.getStaffRevenue(
        salonId,
        filters
      ),

      reportsRepository.getServiceRevenueAnalytics(
        salonId,
        filters
      ),

      reportsRepository.getServiceRevenueTable(
        salonId,
        filters
      ),
    ]);

    return {
      cards,

      charts: {
        revenueTrend,
        categoryRevenue,
        topServices,
        staffRevenue,
      },

      analytics,

      table,
    };
  },

 async getServiceRevenueTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getServiceRevenueTable(
      salonId,
      filters
    );
  },

 async getStylistRevenue(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    const [
      cards,
      revenueTrend,
      departmentRevenue,
      topStylists,
      analytics,
      table,
    ] = await Promise.all([
      reportsRepository.getStylistRevenueCards(
        salonId,
        filters
      ),

      reportsRepository.getStylistRevenueTrend(
        salonId,
        filters
      ),

      reportsRepository.getStylistDepartmentRevenue(
        salonId,
        filters
      ),

      reportsRepository.getTopStylistRevenue(
        salonId,
        filters
      ),

      reportsRepository.getStylistRevenueAnalytics(
        salonId,
        filters
      ),

      reportsRepository.getStylistRevenueTable(
        salonId,
        filters
      ),
    ]);

    return {
      cards,

      charts: {
        revenueTrend,
        departmentRevenue,
        topStylists,
      },

      analytics,

      table,
    };
  },

 async getStylistRevenueTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getStylistRevenueTable(
      salonId,
      filters
    );
  },

async getTipReport(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
      search?: string;
      stylist?: string;
      payment?: string;
      status?: string;
    }
  ) {
    const table = await reportsRepository.getTipReportTable(
      salonId,
      filters
    );

    return {
      table,
    };
  },

 async getTipReportTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getTipReportTable(
      salonId,
      filters
    );
  },

 async getAppointmentReport(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getAppointmentReport(
      salonId,
      filters
    );
  },

 async getAppointmentReportTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getAppointmentTable(
      salonId,
      filters
    );
  },

 async getAppointmentDetailTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
      dateType?: "appointment" | "booking";
      statuses?: string[];
    }
  ) {
    return reportsRepository.getAppointmentDetailTable(
      salonId,
      filters
    );
  },

 async getDailySheetTable(
    salonId: string,
    filters: {
      date: string;
      service?: string;
      staff?: string;
    }
  ) {
    return reportsRepository.getDailySheetTable(
      salonId,
      filters
    );
  },

 async getRewardPointsSummary(
    salonId: string,
    filters: {
      search?: string;
    }
  ) {
    return reportsRepository.getRewardPointsSummary(
      salonId,
      filters
    );
  },

 async getServiceReminderReport(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getServiceReminderReport(
      salonId,
      filters
    );
  },

 async getServiceReminderTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    const data = await reportsRepository.getServiceReminderReport(
      salonId,
      filters
    );

    return data.table;
  },

 async getGuestCollectionReport(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getGuestCollectionReport(
      salonId,
      filters
    );
  },

 async getGuestCollectionTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    const data = await reportsRepository.getGuestCollectionReport(
      salonId,
      filters
    );

    return data.table;
  },

 async getStaffAttendanceReport(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getStaffAttendanceReport(
      salonId,
      filters
    );
  },

 async getStaffAttendanceTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    const data = await reportsRepository.getStaffAttendanceReport(
      salonId,
      filters
    );

    return data.table;
  },

 async getBalanceReceivedReport(
    salonId: string,
    filters: BalanceReceivedReportFilters
  ): Promise<BalanceReceivedReportData> {
    return reportsRepository.getBalanceReceivedReport(
      salonId,
      filters
    );
  },

 async getBalanceReceivedTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    const data = await reportsRepository.getBalanceReceivedReport(
      salonId,
      {
        from: filters.from,
        to: filters.to,
      }
    );

    return data.table;
  },

 async getDayWiseReport(
    salonId: string,
    filters: DayWiseReportFilters
  ): Promise<DayWiseReportData> {
    const [
      cards,
      dailyRevenue,
      appointmentTrend,
      staffProductivity,
      paymentModeSummary,
      analytics,
      table,
    ] = await Promise.all([
      reportsRepository.getDayWiseCards(
        salonId,
        filters
      ),
      reportsRepository.getDayWiseRevenueTrend(
        salonId,
        filters
      ),
      reportsRepository.getAppointmentTrend(
        salonId,
        filters
      ),
      reportsRepository.getStaffProductivity(
        salonId,
        filters
      ),
      reportsRepository.getPaymentModeSummary(
        salonId,
        filters
      ),
      reportsRepository.getDayWiseAnalytics(
        salonId,
        filters
      ),
      reportsRepository.getDayWiseTable(
        salonId,
        filters
      ),
    ]);

    return {
      cards,
      charts: {
        dailyRevenue,
        appointmentTrend,
        staffProductivity,
        paymentModeSummary,
      },
      analytics,
      table,
    };
  },

 async getDayWiseTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getDayWiseTable(
      salonId,
      filters
    );
  },

 async getCouponRedemptionReport(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ): Promise<CouponRedemptionReportData> {
    const [
      cards,
      charts,
      analytics,
      table,
    ] = await Promise.all([
      reportsRepository.getCouponRedemptionCards(
        salonId,
        filters
      ),
      reportsRepository.getCouponRedemptionCharts(
        salonId,
        filters
      ),
      reportsRepository.getCouponRedemptionAnalytics(
        salonId,
        filters
      ),
      reportsRepository.getCouponRedemptionTable(
        salonId,
        filters
      ),
    ]);

    return {
      cards,
      charts,
      analytics,
      table,
    };
  },

 async getCouponRedemptionTable(
    salonId: string,
    filters: {
      from?: string;
      to?: string;
    }
  ) {
    return reportsRepository.getCouponRedemptionTable(
      salonId,
      filters
    );
  },

    async getSalesSummaryTable(
        salonId: string,
        filters: {
            from?: string;
            to?: string;
        }
    ) {
        return reportsRepository.getSalesSummaryTable(
            salonId,
            {
                from: filters.from,
                to: filters.to,
            }
        );
    },

    async getSalesSummary(
        salonId: string,
        query: SalesSummaryQuery
    ): Promise<SalesSummaryData> {

        const range = resolveDateRange(
            query.period,
            query.from,
            query.to
        );

        const {
            from,
            to,
        } = range;

        const [

            categoryRows,

            invoice,

            footfall,

            services,

            products,

            memberships,

            packages,

            stylists,

           

        ] = await Promise.all([

          reportsRepository.getCategoryTotals(
    salonId,
    {
        from,
        to,
    }
),

            reportsRepository.getInvoiceAdjustments(
                salonId,{
                from,
                to}
            ),

            reportsRepository.getFootfallSummary(
                salonId,
                {
        from,
        to,
    },
            ),

            reportsRepository.getTopServices(
                salonId,
                {
        from,
        to,
    },
            ),

            reportsRepository.getTopProducts(
                salonId,
                {
        from,
        to,
    },
            ),

            reportsRepository.getTopMemberships(
                salonId,
                {
        from,
        to,
    },
            ),

            reportsRepository.getTopPackages(
                salonId,
                {
        from,
        to,
    },
            ),

            reportsRepository.getTopStylists(
                salonId,
              {
        from,
        to,
    }
            ),

          

        ]);

        const {

            totals,

            serviceQty,

            itemDiscount

        } = buildCategoryTotals(
            categoryRows
        );

        const invoiceCount =
            parseInt(
                invoice.invoice_count || "0",
                10
            );

        const totalRevenue =
            round2(

                totals.serviceNetSale +

                totals.productNetSale +

                totals.packageNetSale +

                totals.membershipNetSale +

                totals.giftCardNetSale

            );

        const discount =
            round2(

                itemDiscount +

                toNum(
                    invoice.extra_discount_total
                )

            );

        const tax =
            round2(

                toNum(
                    invoice.tax_total
                )

            );

        const refund =
            round2(

                toNum(
                    invoice.refund_total
                )

            );

        const totalGuest =
            parseInt(
                footfall.total_guest || "0",
                10
            );

        const newGuest =
            parseInt(
                footfall.new_guest || "0",
                10
            );

        const guestPurchasedServices =
            parseInt(
                footfall.guest_purchased_services || "0",
                10
            );

        const repeatGuest =
            Math.max(
                totalGuest - newGuest,
                0
            );


        return {

            filters: range,

            summaryCards: totals,

            revenueSources: {

                ...totals,

                totalRevenue,

            },

            adjustments: {

                discount,

                tax,

                refund,

            },

            footfallSummary: {

                totalGuest,

                newGuest,

                repeatGuest,

                guestPurchasedServices,

            },

            averageSaleSummary: {

                averageBillValue: safeDiv(
                    totalRevenue,
                    invoiceCount
                ),

                averageGuestSpend: safeDiv(
                    totalRevenue,
                    totalGuest
                ),

                averageServicePerInvoice: safeDiv(
                    serviceQty,
                    invoiceCount
                ),

            },

            top5ServiceSales:
                mapTopServices(
                    services
                ),

            top5ProductSales:
                mapTopProducts(
                    products
                ),

            top5MembershipSales:
                mapTopMemberships(
                    memberships
                ),

            top5PackageSales:
                mapTopPackages(
                    packages
                ),

            top5StylistSales:

                stylists.map(stylist => ({

                    id: stylist.id,

                    stylistName:
                        `${stylist.first_name ?? ""} ${stylist.last_name ?? ""}`.trim(),

                    bookingCount:
                        parseInt(
                            stylist.booking_count || "0",
                            10
                        ),

                    revenue:
                        round2(
                            toNum(
                                stylist.revenue
                            )
                        ),

                })),

         

        };

    },

    // ======================================================
// PRODUCT REVENUE REPORT
// ======================================================

async getProductRevenueReport(
    salonId: string,
    filters: {
        search?: string;
        from?: string;
        to?: string;
        category_id?: string;
        brand_id?: string;
        sales_person?: string;
        payment_mode?: string;
        page?: number;
        limit?: number;
    }
) {
const [
    cards,
    revenueTrend,
    categoryRevenue,
    topProducts,
    analytics,
    table
] = await Promise.all([
    reportsRepository.getProductRevenueCards(
        salonId,
        filters,
    ),

    reportsRepository.getRevenueTrend(
        salonId,
       filters, 
    ),

    reportsRepository.getCategoryRevenue(
        salonId,
        filters,
    ),

    reportsRepository.getTopRevenueProducts(
        salonId,
        filters,
    ),

    reportsRepository.getProductRevenueAnalytics(
        salonId,
          filters,
    ),

    reportsRepository.getProductRevenueTable(
        salonId,
       filters,
    )
]);
    return {

        cards,

        charts: {
            revenueTrend,
            categoryRevenue,
            topProducts,
        },

        analytics,

        table,
    };
},

async getProductRevenueTable(
    salonId: string,
    filters: {
        from?: string;
        to?: string;
    }
) {
    return reportsRepository.getProductRevenueTable(
        salonId,
        filters,
    );
},

async getProductRevenue(
    salonId: string,
    query: {
        from?: string;
        to?: string;
    }
) {

    const { from, to } = resolveDateRange(
        "custom",
        query.from,
        query.to
    );

    const [
        summary,
        charts,
        analytics,
        table
    ] = await Promise.all([

        reportsRepository.getProductRevenueCards(
            salonId,
            { from, to }
        ),

        reportsRepository.getTopRevenueProducts(
            salonId,
            { from, to }
        ),

        reportsRepository.getProductRevenueAnalytics(
            salonId,
            {from,
            to}
        ),

        reportsRepository.getProductRevenueTable(
            salonId,
           { from,
            to}
        )

    ]);

    return {

        filters: {
            from,
            to,
        },

        cards: summary,

        charts,

      analytics: {

    highestRevenueProduct:
        analytics.highestRevenueProduct ?? "-",

    topBrand:
        analytics.topBrand ?? "-",

    topCategory:
        analytics.topCategory ?? "-",

    topSalesPerson:
        analytics.topSalesPerson ?? "-",

    averageOrderValue:
        Number(analytics.averageOrderValue ?? 0),

    profitMargin:
        Number(analytics.profitMargin ?? 0),

},
        table,

    };
}
,

// ======================================================
// INDEPENDENT REPORT APIs — POST /api/report/*
// ======================================================

async getSalesSummaryReport(
    salonId: string,
    filters: SalesSummaryReportFilters
): Promise<SalesSummaryReportResponse> {
    const [statsRaw, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getSalesSummaryReportStats(salonId, filters),
        reportsRepository.getSalesSummaryReportRows(salonId, filters),
        reportsRepository.getSalesSummaryFiltersAvailable(salonId),
    ]);

    const bill_average = statsRaw.total_bill > 0
        ? statsRaw.total_sale / statsRaw.total_bill
        : 0;

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats: { ...statsRaw, bill_average },
        filters_available: filtersAvailable,
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
        total_paid: result.total_paid,
        total_due: result.total_due,
        invoice_count: result.invoice_count,
        client_count: result.client_count,
        staff_count: result.staff_count,
        items_count: result.items_count,
        pending_payment_count: result.pending_payment_count,
        fully_paid_count: result.fully_paid_count,
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
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getServiceSaleReportStats(salonId, filters),
        reportsRepository.getServiceSaleReportRows(salonId, filters),
        reportsRepository.getServiceSaleFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
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

async getProductInventorySales(
    salonId: string,
    filters: { start_date?: string; end_date?: string }
): Promise<Record<string, { quantity: number; revenue: number }>> {
    return reportsRepository.getProductInventorySales(salonId, filters);
},

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
// PRODUCT INVENTORY REPORT (independent report API)
// ======================================================

async getProductInventoryReport(
    salonId: string,
    filters: ProductInventoryReportFilters
): Promise<ProductInventoryReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getProductInventoryReportStats(salonId, filters),
        reportsRepository.getProductInventoryReportRows(salonId, filters),
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
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getStaffSalesReportStats(salonId, filters),
        reportsRepository.getStaffSalesReport(salonId, filters),
    ]);
    return { rows: rowsResult.items, pagination: rowsResult.pagination, stats };
},

// ======================================================
// STAFF PERFORMANCE REPORT (independent report API)
// ======================================================

async getStaffPerformanceReport(
    salonId: string,
    filters: StaffPerformanceReportFilters
): Promise<StaffPerformanceReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getStaffPerformanceReportStats(salonId, filters),
        reportsRepository.getStaffPerformanceReport(salonId, filters),
        reportsRepository.getStaffPerformanceFiltersAvailable(salonId),
    ]);
    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
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
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getPackageSaleReportStats(salonId, filters),
        reportsRepository.getPackageSaleReportRows(salonId, filters),
        reportsRepository.getPackageSaleFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// ======================================================

async getPackageHistoryReport(
    salonId: string,
    filters: PackageHistoryReportFilters
): Promise<PackageHistoryReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getPackageHistoryReportStats(salonId, filters),
        reportsRepository.getPackageHistoryReportRows(salonId, filters),
        reportsRepository.getPackageHistoryFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// MEMBER SALE REPORT (independent report API)
// ======================================================

async getMemberSaleReport(
    salonId: string,
    filters: MemberSaleReportFilters
): Promise<MemberSaleReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getMemberSaleReportStats(salonId, filters),
        reportsRepository.getMemberSaleReportRows(salonId, filters),
        reportsRepository.getMemberSaleFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
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

async getWaCampaignReport(
    salonId: string,
    filters: WaCampaignReportFilters
): Promise<WaCampaignReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getWaCampaignReportStats(salonId, filters),
        reportsRepository.getWaCampaignReportRows(salonId, filters),
        reportsRepository.getWaCampaignFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

};
