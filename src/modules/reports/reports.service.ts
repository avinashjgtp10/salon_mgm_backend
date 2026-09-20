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
    SalesSummaryChartResponse,
    SaleDetailResponse,
    DailySheetReportFilters,
    DailySheetReportResponse,
    ProductRetailReportFilters,
    ProductRetailReportResponse,
    ProductRetailChartFilters,
    ProductRetailChartResponse,
    ServiceSaleReportFilters,
    ServiceSaleReportResponse,
    ServiceSaleChartFilters,
    ServiceSaleChartResponse,
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
    ProductInventoryChartFilters,
    ProductInventoryChartResponse,
    ProductMovementReportFilters,
    ProductMovementReportResponse,
    BrandPerformanceReportFilters,
    BrandPerformanceReportResponse,
    PurchaseVsSalesReportFilters,
    PurchaseVsSalesReportResponse,
    StockMovementReportFilters,
    StockMovementReportResponse,
    ClientRevenueReportFilters,
    ClientRevenueReportResponse,
    ClientRevenueChartFilters,
    ClientRevenueChartResponse,
    AllClientsReportFilters,
    AllClientsReportResponse,
    NewClientFollowUpFilters,
    NewClientFollowUpResponse,
    CancellationRecoveryFilters,
    CancellationRecoveryResponse,
    MembershipOpportunityFilters,
    MembershipOpportunityResponse,
    NoShowRecoveryFilters,
    NoShowRecoveryResponse,
    EnquiryReportFilters,
    EnquiryReportResponse,
    EnquiryChartFilters,
    EnquiryChartResponse,
    CustomerFrequencyReportFilters,
    CustomerFrequencyReportResponse,
    CustomerFrequencyChartFilters,
    CustomerFrequencyChartResponse,
    LostCustomersReportFilters,
    LostCustomersReportResponse,
    ReferralReportFilters,
    ReferralReportResponse,
    PaymentCollectionReportFilters,
    PaymentCollectionReportResponse,
    PaymentCollectionChartFilters,
    PaymentCollectionChartResponse,
    PendingPaymentReportFilters,
    PendingPaymentReportResponse,
    CashManagementReportFilters,
    CashManagementReportResponse,
    CashManagementChartFilters,
    CashManagementChartResponse,
    MembershipHistoryReportFilters,
    MembershipHistoryReportResponse,
    ServiceFrequencyReportFilters,
    ServiceFrequencyReportResponse,
    ServiceFrequencyChartFilters,
    ServiceFrequencyChartResponse,
    CustomerSpendReportFilters,
    CustomerSpendReportResponse,
    StaffSalesReportFilters,
    StaffSalesReportResponse,
    StaffSalesChartFilters,
    StaffSalesChartResponse,
    StaffPerformanceReportFilters,
    StaffPerformanceReportResponse,
    StaffPerformanceChartFilters,
    StaffPerformanceChartResponse,
    StaffItemSalesReportFilters,
    StaffItemSalesReportResponse,
    StaffItemSalesChartFilters,
    StaffItemSalesChartResponse,
    PackageSaleReportFilters,
    PackageSaleReportResponse,
    PackageSaleChartFilters,
    PackageSaleChartResponse,
    PayrollHistoryReportFilters,
    PayrollHistoryReportResponse,
    PackageHistoryReportFilters,
    PackageHistoryReportResponse,
    MemberSaleReportFilters,
    MemberSaleReportResponse,
    MemberSaleChartFilters,
    MemberSaleChartResponse,
    AppointmentDetailReportFilters,
    AppointmentDetailReportResponse,
    UpcomingAppointmentsReportFilters,
    UpcomingAppointmentsReportResponse,
    WaCampaignReportFilters,
    WaCampaignReportResponse,
    OpenRateReportFilters,
    OpenRateReportResponse,
    OpenRateCampaignDetail,
    ReplyRateReportResponse,
    ReplyRateCampaignDetail,
    BirthdayCampaignReportFilters,
    BirthdayCampaignReportResponse,
    ClientRatingReportFilters,
    ClientRatingReportResponse,
    RebookingRateReportFilters,
    RebookingRateReportResponse,
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

async getSalesSummaryReportChart(
    salonId: string,
    filters: SalesSummaryReportFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<SalesSummaryChartResponse> {
    const [
        daily, payment_modes, item_types, payment_status,
        top_staff, top_services, categories, heatmap,
        current_period, previous_period,
    ] = await Promise.all([
        reportsRepository.getSalesSummaryReportChart(salonId, filters, granularity),
        reportsRepository.getSalesSummaryPaymentModeBreakdown(salonId, filters),
        reportsRepository.getSalesSummaryByItemType(salonId, filters),
        reportsRepository.getSalesSummaryByPaymentStatus(salonId, filters),
        reportsRepository.getSalesSummaryTopStaff(salonId, filters, topLimit),
        reportsRepository.getSalesSummaryTopServices(salonId, filters, topLimit),
        reportsRepository.getSalesSummaryByCategory(salonId, filters),
        reportsRepository.getSalesSummaryHeatmap(salonId, filters),
        reportsRepository.getSalesSummaryReportStats(salonId, filters),
        reportsRepository.getSalesSummaryPreviousPeriodStats(salonId, filters),
    ]);

    return {
        daily, payment_modes, item_types, payment_status,
        top_staff, top_services, categories, heatmap,
        current_period: {
            total_bill: current_period.total_bill,
            total_sale: current_period.total_sale,
            received_amount: current_period.received_amount,
        },
        previous_period,
    };
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

// Powers the Product Retail report's Graph page — same shape as
// getSalesSummaryReportChart above, generalized to this report's own
// filters/tables instead.
async getProductRetailReportChart(
    salonId: string,
    filters: ProductRetailChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<ProductRetailChartResponse> {
    const [daily, payment_modes, top_products, top_brands, top_categories, top_staff] = await Promise.all([
        reportsRepository.getProductRetailChartTrend(salonId, filters, granularity),
        reportsRepository.getProductRetailPaymentModeBreakdown(salonId, filters),
        reportsRepository.getProductRetailTopProducts(salonId, filters, topLimit),
        reportsRepository.getProductRetailTopBrands(salonId, filters, topLimit),
        reportsRepository.getProductRetailTopCategories(salonId, filters, topLimit),
        reportsRepository.getProductRetailTopStaff(salonId, filters, topLimit),
    ]);

    return { daily, payment_modes, top_products, top_brands, top_categories, top_staff };
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

// Powers the Service Sale report's Graph page.
async getServiceSaleReportChart(
    salonId: string,
    filters: ServiceSaleChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<ServiceSaleChartResponse> {
    const [daily, payment_modes, top_services, top_categories, top_staff] = await Promise.all([
        reportsRepository.getServiceSaleChartTrend(salonId, filters, granularity),
        reportsRepository.getServiceSalePaymentModeBreakdown(salonId, filters),
        reportsRepository.getServiceSaleTopServices(salonId, filters, topLimit),
        reportsRepository.getServiceSaleTopCategories(salonId, filters, topLimit),
        reportsRepository.getServiceSaleTopStaff(salonId, filters, topLimit),
    ]);

    return { daily, payment_modes, top_services, top_categories, top_staff };
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

// Powers the Product Inventory report's Graph page.
async getProductInventoryChart(
    salonId: string,
    filters: ProductInventoryChartFilters,
    topLimit: number = 5
): Promise<ProductInventoryChartResponse> {
    const [by_status, by_category, top_products] = await Promise.all([
        reportsRepository.getProductInventoryChartByStatus(salonId, filters),
        reportsRepository.getProductInventoryChartByCategory(salonId, filters, topLimit),
        reportsRepository.getProductInventoryChartTopProducts(salonId, filters, topLimit),
    ]);
    return { by_status, by_category, top_products };
},

// ======================================================
// SLOW MOVING / FAST MOVING PRODUCTS REPORTS (independent report APIs)
// Same repository query for both — only the default sort direction differs.
// ======================================================

async getSlowMovingProductsReport(
    salonId: string,
    filters: ProductMovementReportFilters
): Promise<ProductMovementReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getProductMovementReportStats(salonId, filters),
        reportsRepository.getProductMovementReportRows(salonId, filters, "asc"),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

async getFastMovingProductsReport(
    salonId: string,
    filters: ProductMovementReportFilters
): Promise<ProductMovementReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getProductMovementReportStats(salonId, filters),
        reportsRepository.getProductMovementReportRows(salonId, filters, "desc"),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// BRAND PERFORMANCE REPORT (independent report API)
// ======================================================

async getBrandPerformanceReport(
    salonId: string,
    filters: BrandPerformanceReportFilters
): Promise<BrandPerformanceReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getBrandPerformanceReportStats(salonId, filters),
        reportsRepository.getBrandPerformanceReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// PURCHASE VS SALES INVENTORY REPORT (independent report API)
// ======================================================

async getPurchaseVsSalesReport(
    salonId: string,
    filters: PurchaseVsSalesReportFilters
): Promise<PurchaseVsSalesReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getPurchaseVsSalesReportStats(salonId, filters),
        reportsRepository.getPurchaseVsSalesReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// STOCK MOVEMENT REPORT (independent report API)
// ======================================================

async getStockMovementReport(
    salonId: string,
    filters: StockMovementReportFilters
): Promise<StockMovementReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getStockMovementReportStats(salonId, filters),
        reportsRepository.getStockMovementReportRows(salonId, filters),
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

// Powers the Client Revenue report's Graph page.
async getClientRevenueReportChart(
    salonId: string,
    filters: ClientRevenueChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<ClientRevenueChartResponse> {
    const [daily, gender, membership_status, top_clients] = await Promise.all([
        reportsRepository.getClientRevenueChartTrend(salonId, filters, granularity),
        reportsRepository.getClientRevenueByGender(salonId, filters),
        reportsRepository.getClientRevenueByMembership(salonId, filters),
        reportsRepository.getClientRevenueTopClients(salonId, filters, topLimit),
    ]);

    return { daily, gender, membership_status, top_clients };
},

// ======================================================
// ALL CLIENTS REPORT (independent report API)
// ======================================================

async getAllClientsReport(
    salonId: string,
    filters: AllClientsReportFilters
): Promise<AllClientsReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getAllClientsReportStats(salonId, filters),
        reportsRepository.getAllClientsReportRows(salonId, filters),
        reportsRepository.getAllClientsFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// NEW CLIENT FOLLOW-UP REPORT (independent report API)
// ======================================================

async getNewClientFollowUpReport(
    salonId: string,
    filters: NewClientFollowUpFilters
): Promise<NewClientFollowUpResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getNewClientFollowUpStats(salonId, filters),
        reportsRepository.getNewClientFollowUpRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// CANCELLATION RECOVERY REPORT (independent report API)
// ======================================================

async getCancellationRecoveryReport(
    salonId: string,
    filters: CancellationRecoveryFilters
): Promise<CancellationRecoveryResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getCancellationRecoveryStats(salonId, filters),
        reportsRepository.getCancellationRecoveryRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// MEMBERSHIP OPPORTUNITY REPORT (independent report API)
// ======================================================

async getMembershipOpportunityReport(
    salonId: string,
    filters: MembershipOpportunityFilters
): Promise<MembershipOpportunityResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getMembershipOpportunityStats(salonId, filters),
        reportsRepository.getMembershipOpportunityRows(salonId, filters),
        reportsRepository.getMembershipOpportunityFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// NO-SHOW RECOVERY REPORT (independent report API)
// ======================================================

async getNoShowRecoveryReport(
    salonId: string,
    filters: NoShowRecoveryFilters
): Promise<NoShowRecoveryResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getNoShowRecoveryStats(salonId, filters),
        reportsRepository.getNoShowRecoveryRows(salonId, filters),
        reportsRepository.getNoShowRecoveryFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// ENQUIRY REPORT (independent report API)
// ======================================================

async getEnquiryReport(
    salonId: string,
    filters: EnquiryReportFilters
): Promise<EnquiryReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getEnquiryReportStats(salonId, filters),
        reportsRepository.getEnquiryReportRows(salonId, filters),
        reportsRepository.getEnquiryReportFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// Powers the Enquiry Report's Graph page.
async getEnquiryReportChart(
    salonId: string,
    filters: EnquiryChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<EnquiryChartResponse> {
    const [daily, status, source, top_staff] = await Promise.all([
        reportsRepository.getEnquiryChartTrend(salonId, filters, granularity),
        reportsRepository.getEnquiryChartByStatus(salonId, filters),
        reportsRepository.getEnquiryChartBySource(salonId, filters),
        reportsRepository.getEnquiryChartTopStaff(salonId, filters, topLimit),
    ]);

    return { daily, status, source, top_staff };
},

// ======================================================
// CUSTOMER FREQUENCY REPORT (independent report API)
// ======================================================

async getCustomerFrequencyReport(
    salonId: string,
    filters: CustomerFrequencyReportFilters
): Promise<CustomerFrequencyReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getCustomerFrequencyReportStats(salonId, filters),
        reportsRepository.getCustomerFrequencyReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// Powers the Client Frequency report's Graph page.
async getCustomerFrequencyReportChart(
    salonId: string,
    filters: CustomerFrequencyChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<CustomerFrequencyChartResponse> {
    const [daily, customer_type, visitor_type, top_clients] = await Promise.all([
        reportsRepository.getCustomerFrequencyChartTrend(salonId, filters, granularity),
        reportsRepository.getCustomerFrequencyByType(salonId, filters),
        reportsRepository.getCustomerFrequencyByVisitorType(salonId, filters),
        reportsRepository.getCustomerFrequencyTopClients(salonId, filters, topLimit),
    ]);

    return { daily, customer_type, visitor_type, top_clients };
},

// ======================================================
// LOST CUSTOMERS REPORT (independent report API)
// ======================================================

async getLostCustomersReport(
    salonId: string,
    filters: LostCustomersReportFilters
): Promise<LostCustomersReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getLostCustomersReportStats(salonId, filters),
        reportsRepository.getLostCustomersReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// REFERRAL REPORT (independent report API)
// ======================================================

async getReferralReport(
    salonId: string,
    filters: ReferralReportFilters
): Promise<ReferralReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getReferralReportStats(salonId, filters),
        reportsRepository.getReferralReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// CUSTOMER SPEND SEGMENTS REPORT (independent report API)
// ======================================================

async getCustomerSpendReport(
    salonId: string,
    filters: CustomerSpendReportFilters
): Promise<CustomerSpendReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getCustomerSpendReportStats(salonId, filters),
        reportsRepository.getCustomerSpendReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// SERVICE FREQUENCY REPORT (independent report API)
// ======================================================

async getServiceFrequencyReport(
    salonId: string,
    filters: ServiceFrequencyReportFilters
): Promise<ServiceFrequencyReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getServiceFrequencyReportStats(salonId, filters),
        reportsRepository.getServiceFrequencyReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// Powers the Service Frequency report's Graph page.
async getServiceFrequencyReportChart(
    salonId: string,
    filters: ServiceFrequencyChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<ServiceFrequencyChartResponse> {
    const [daily, pair_frequency, category_breakdown, top_services] = await Promise.all([
        reportsRepository.getServiceFrequencyChartTrend(salonId, filters, granularity),
        reportsRepository.getServiceFrequencyChartPairFrequency(salonId, filters),
        reportsRepository.getServiceFrequencyChartByCategory(salonId, filters),
        reportsRepository.getServiceFrequencyChartTopServices(salonId, filters, topLimit),
    ]);

    return { daily, pair_frequency, category_breakdown, top_services };
},

// ======================================================
// MEMBERSHIP HISTORY REPORT (independent report API)
// ======================================================

async getMembershipHistoryReport(
    salonId: string,
    filters: MembershipHistoryReportFilters
): Promise<MembershipHistoryReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getMembershipHistoryReportStats(salonId, filters),
        reportsRepository.getMembershipHistoryReportRows(salonId, filters),
        reportsRepository.getMembershipHistoryFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// PAYMENT COLLECTION REPORT (independent report API)
// ======================================================

async getPaymentCollectionReport(
    salonId: string,
    filters: PaymentCollectionReportFilters
): Promise<PaymentCollectionReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getPaymentCollectionReportStats(salonId, filters),
        reportsRepository.getPaymentCollectionReportRows(salonId, filters),
        reportsRepository.getPaymentCollectionFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// Powers the Payment Collection report's Graph page. payment_modes reuses
// getPaymentCollectionReportStats's own collected_by_method (same
// transaction-level source the "Total Paid" stat card already trusts)
// instead of a duplicated query.
async getPaymentCollectionReportChart(
    salonId: string,
    filters: PaymentCollectionChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<PaymentCollectionChartResponse> {
    const [daily, payment_status, stats, top_staff_pending, top_clients_due] = await Promise.all([
        reportsRepository.getPaymentCollectionChartTrend(salonId, filters, granularity),
        reportsRepository.getPaymentCollectionByStatus(salonId, filters),
        reportsRepository.getPaymentCollectionReportStats(salonId, filters),
        reportsRepository.getPaymentCollectionTopStaffPending(salonId, filters, topLimit),
        reportsRepository.getPaymentCollectionTopClientsDue(salonId, filters, topLimit),
    ]);

    return {
        daily,
        payment_status,
        payment_modes: stats.collected_by_method.map((m) => ({ method: m.method, amount: m.amount })),
        top_staff_pending,
        top_clients_due,
    };
},

// ======================================================
// PENDING PAYMENT REPORT (independent report API)
// ======================================================

async getPendingPaymentReport(
    salonId: string,
    filters: PendingPaymentReportFilters
): Promise<PendingPaymentReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getPendingPaymentReportStats(salonId, filters),
        reportsRepository.getPendingPaymentReportRows(salonId, filters),
        reportsRepository.getPendingPaymentFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// ======================================================
// CASH MANAGEMENT REPORT (independent report API)
// ======================================================

async getCashManagementReport(
    salonId: string,
    filters: CashManagementReportFilters
): Promise<CashManagementReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getCashManagementReportStats(salonId, filters),
        reportsRepository.getCashManagementReportRows(salonId, filters),
        reportsRepository.getCashManagementFiltersAvailable(),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

// Powers the Cash Management report's Graph page.
async getCashManagementReportChart(
    salonId: string,
    filters: CashManagementChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<CashManagementChartResponse> {
    const [daily, status, top_variance, revenue_by_opened_by] = await Promise.all([
        reportsRepository.getCashManagementChartTrend(salonId, filters, granularity),
        reportsRepository.getCashManagementByStatus(salonId, filters),
        reportsRepository.getCashManagementTopVariance(salonId, filters, topLimit),
        reportsRepository.getCashManagementByOpenedBy(salonId, filters, topLimit),
    ]);

    return { daily, status, top_variance, revenue_by_opened_by };
},

// ======================================================
// STAFF SALES REPORT (independent report API)
// ======================================================

async getStaffSalesReport(
    salonId: string,
    filters: StaffSalesReportFilters
): Promise<StaffSalesReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getStaffSalesReportStats(salonId, filters),
        reportsRepository.getStaffSalesReport(salonId, filters),
        reportsRepository.getSalesSummaryFiltersAvailable(salonId),
    ]);
    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: { payment_modes: filtersAvailable.payment_modes },
    };
},

// Powers the Staff Sales report's Graph page.
async getStaffSalesReportChart(
    salonId: string,
    filters: StaffSalesChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<StaffSalesChartResponse> {
    const [daily, by_item_type, top_staff] = await Promise.all([
        reportsRepository.getStaffSalesChartTrend(salonId, filters, granularity),
        reportsRepository.getStaffSalesChartByItemType(salonId, filters),
        reportsRepository.getStaffSalesChartTopStaff(salonId, filters, topLimit),
    ]);
    return { daily, by_item_type, top_staff };
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

// Powers the Staff Performance report's Graph page.
async getStaffPerformanceReportChart(
    salonId: string,
    filters: StaffPerformanceChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<StaffPerformanceChartResponse> {
    const [daily, by_item_type, top_staff] = await Promise.all([
        reportsRepository.getStaffPerformanceChartTrend(salonId, filters, granularity),
        reportsRepository.getStaffPerformanceChartByItemType(salonId, filters),
        reportsRepository.getStaffPerformanceChartTopStaff(salonId, filters, topLimit),
    ]);
    return { daily, by_item_type, top_staff };
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

// Powers the Staff Item Sales report's Graph page.
async getStaffItemSalesReportChart(
    salonId: string,
    filters: StaffItemSalesChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<StaffItemSalesChartResponse> {
    const [daily, top_items, top_staff] = await Promise.all([
        reportsRepository.getStaffItemSalesChartTrend(salonId, filters, granularity),
        reportsRepository.getStaffItemSalesChartTopItems(salonId, filters, topLimit),
        reportsRepository.getStaffItemSalesChartTopStaff(salonId, filters, topLimit),
    ]);
    return { daily, top_items, top_staff };
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

// Powers the Package Sale report's Graph page.
async getPackageSaleChart(
    salonId: string,
    filters: PackageSaleChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<PackageSaleChartResponse> {
    const [daily, top_packages, top_staff] = await Promise.all([
        reportsRepository.getPackageSaleChartTrend(salonId, filters, granularity),
        reportsRepository.getPackageSaleChartTopPackages(salonId, filters, topLimit),
        reportsRepository.getPackageSaleChartTopStaff(salonId, filters, topLimit),
    ]);
    return { daily, top_packages, top_staff };
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

// Powers the Membership Sale report's Graph page.
async getMemberSaleChart(
    salonId: string,
    filters: MemberSaleChartFilters,
    granularity: "day" | "week" | "month" = "day",
    topLimit: number = 5
): Promise<MemberSaleChartResponse> {
    const [daily, top_memberships, top_staff] = await Promise.all([
        reportsRepository.getMemberSaleChartTrend(salonId, filters, granularity),
        reportsRepository.getMemberSaleChartTopMemberships(salonId, filters, topLimit),
        reportsRepository.getMemberSaleChartTopStaff(salonId, filters, topLimit),
    ]);
    return { daily, top_memberships, top_staff };
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

// ======================================================
// UPCOMING APPOINTMENTS REPORT (independent report API)
// ======================================================

async getUpcomingAppointmentsReport(
    salonId: string,
    filters: UpcomingAppointmentsReportFilters
): Promise<UpcomingAppointmentsReportResponse> {
    const [result, filtersAvailable] = await Promise.all([
        reportsRepository.getUpcomingAppointmentsReport(salonId, filters),
        reportsRepository.getUpcomingAppointmentsFiltersAvailable(salonId),
    ]);
    return {
        rows: result.items,
        pagination: result.pagination,
        filters_available: filtersAvailable,
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

// ======================================================
// OPEN RATE REPORT (independent report API)
// Shares the WA state definitions with getWaCampaignReport above — see
// reports.repository.ts's WA_*_COUNT constants.
// ======================================================

async getOpenRateReport(
    salonId: string,
    filters: OpenRateReportFilters
): Promise<OpenRateReportResponse> {
    // getOpenRateTrend is deliberately NOT called here. The report has no
    // charts, so nothing consumes a trend series — running it would add a DB
    // round-trip per request for data that gets thrown away. The repository
    // method is kept for whenever a trend view is wanted again.
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getOpenRateReportStats(salonId, filters),
        reportsRepository.getOpenRateReportRows(salonId, filters),
        reportsRepository.getOpenRateFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

async getOpenRateCampaignDetail(
    salonId: string,
    campaignId: string,
    opts: { status?: string; page?: number; limit?: number; search?: string }
): Promise<OpenRateCampaignDetail | null> {
    return reportsRepository.getOpenRateCampaignDetail(salonId, campaignId, opts);
},

// ======================================================
// BIRTHDAY CAMPAIGN PERFORMANCE REPORT (independent report API)
// ======================================================

async getBirthdayCampaignReport(
    salonId: string,
    filters: BirthdayCampaignReportFilters
): Promise<BirthdayCampaignReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getBirthdayCampaignReportStats(salonId, filters),
        reportsRepository.getBirthdayCampaignReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// REPLY RATE REPORT (independent report API)
// Same filters and campaign set as the Open Rate report above.
// ======================================================

async getReplyRateReport(
    salonId: string,
    filters: OpenRateReportFilters
): Promise<ReplyRateReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getReplyRateReportStats(salonId, filters),
        reportsRepository.getReplyRateReportRows(salonId, filters),
        reportsRepository.getOpenRateFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

async getReplyRateCampaignDetail(
    salonId: string,
    campaignId: string,
    opts: { replied?: "yes" | "no"; page?: number; limit?: number; search?: string }
): Promise<ReplyRateCampaignDetail | null> {
    return reportsRepository.getReplyRateCampaignDetail(salonId, campaignId, opts);
},

// ======================================================
// CLIENT RATING REPORT (independent report API)
// ======================================================

async getClientRatingReport(
    salonId: string,
    filters: ClientRatingReportFilters
): Promise<ClientRatingReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getClientRatingReportStats(salonId, filters),
        reportsRepository.getClientRatingReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// REBOOKING RATE REPORT (independent report API)
// ======================================================

async getRebookingRateReport(
    salonId: string,
    filters: RebookingRateReportFilters
): Promise<RebookingRateReportResponse> {
    const [stats, rowsResult] = await Promise.all([
        reportsRepository.getRebookingRateReportStats(salonId, filters),
        reportsRepository.getRebookingRateReportRows(salonId, filters),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
    };
},

// ======================================================
// PAYROLL HISTORY REPORT (independent report API)
// ======================================================

async getPayrollHistoryReport(
    salonId: string,
    filters: PayrollHistoryReportFilters
): Promise<PayrollHistoryReportResponse> {
    const [stats, rowsResult, filtersAvailable] = await Promise.all([
        reportsRepository.getPayrollHistoryReportStats(salonId, filters),
        reportsRepository.getPayrollHistoryReportRows(salonId, filters),
        reportsRepository.getPayrollHistoryFiltersAvailable(salonId),
    ]);

    return {
        rows: rowsResult.items,
        pagination: rowsResult.pagination,
        stats,
        filters_available: filtersAvailable,
    };
},

};
