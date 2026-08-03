import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import { sendSuccess } from "../utils/response.util";
import { getSalonId } from "../utils/salon.util";
import { AppError } from "../../middleware/error.middleware";

type AuthRequest = Request & {
    user?: {
        userId: string;
        role?: string;
        salonId?: string | null;
    };
};

const asString = (value: unknown): string | undefined => {
    return typeof value === "string" && value.trim() !== ""
        ? value
        : undefined;
};

// ======================================================
// LEGACY REPORTS (pre-existing GET-based reports module)
// Mounted at /api/v1/reports via legacyReports.routes.ts — kept alongside
// the newer independent POST /api/report/* endpoints below.
// ======================================================

export const reportsController = {

 async getSalesSummary(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {

    try {

        const salonId = await getSalonId(req);

        const query = {
            period: asString(req.query.period),
            from: asString(req.query.from),
            to: asString(req.query.to),
        };

        const data = await reportsService.getSalesSummary(
            salonId,
            query
        );

        sendSuccess(
            res,
            200,
            data,
            "Sales Summary fetched successfully"
        );

    } catch (err) {
        next(err);
    }

},

async getSalesSummaryTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {

    try {

        const salonId = await getSalonId(req);

        const data = await reportsService.getSalesSummaryTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Sales Summary table fetched successfully"
        );

    } catch (err) {
        next(err);
    }

},


// ======================================================
// PRODUCT REVENUE REPORT
// GET /api/v1/reports/product-revenue
// ======================================================

async getProductRevenueReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getProductRevenueReport(
            salonId,
            {
                search: asString(req.query.search),

                from: asString(req.query.from),

                to: asString(req.query.to),

                category_id: asString(req.query.category_id),

                brand_id: asString(req.query.brand_id),

                sales_person: asString(req.query.sales_person),

                payment_mode: asString(req.query.payment_mode),

                page: req.query.page ? Number(req.query.page) : undefined,

                limit: req.query.limit ? Number(req.query.limit) : undefined,
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Product revenue report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

async getProductRevenueTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getProductRevenueTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Product revenue table fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

async getProductRevenue(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getProductRevenue(
         salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Product revenue report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

// ======================================================
// SERVICE REVENUE REPORT
// GET /api/v1/reports/service-revenue
// ======================================================

async getServiceRevenue(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getServiceRevenue(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Service revenue report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getServiceRevenueTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getServiceRevenueTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Service revenue table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getStylistRevenue(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getStylistRevenue(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Stylist revenue report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getStylistRevenueTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getStylistRevenueTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Stylist revenue table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getTipReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getTipReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
                search: asString(req.query.search),
                stylist: asString(req.query.stylist),
                payment: asString(req.query.payment),
                status: asString(req.query.status),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Tip report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getTipReportTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getTipReportTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Tip report table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getAppointmentReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getAppointmentReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Appointment report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getAppointmentReportTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getAppointmentReportTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Appointment report table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getAppointmentDetailTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const statusesRaw = asString(req.query.statuses);

        const data = await reportsService.getAppointmentDetailTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
                dateType: req.query.dateType === "booking" ? "booking" : "appointment",
                statuses: statusesRaw ? statusesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Appointment detail report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getDailySheetTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const date = asString(req.query.date);

        if (!date) {
            res.status(400).json({ success: false, message: "date is required" });
            return;
        }

        const data = await reportsService.getDailySheetTable(
            salonId,
            {
                date,
                service: asString(req.query.service),
                staff: asString(req.query.staff),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Daily sheet report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getRewardPointsSummary(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getRewardPointsSummary(
            salonId,
            {
                search: asString(req.query.search),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Reward points summary fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getServiceReminderReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getServiceReminderReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Service reminder report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getServiceReminderTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getServiceReminderTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Service reminder table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getGuestCollectionReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getGuestCollectionReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Guest collection report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getGuestCollectionTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getGuestCollectionTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Guest collection table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getStaffAttendanceReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getStaffAttendanceReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Staff attendance report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getStaffAttendanceTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getStaffAttendanceTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Staff attendance table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getBalanceReceivedReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getBalanceReceivedReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
                search: asString(req.query.search),
                page: req.query.page ? Number(req.query.page) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
                sort_by: asString(req.query.sort_by),
                sort_order: asString(req.query.sort_order) as "asc" | "desc" | undefined,
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Balance received report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getBalanceReceivedTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getBalanceReceivedTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Balance received table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getDayWiseReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getDayWiseReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
                search: asString(req.query.search),
                page: req.query.page ? Number(req.query.page) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
                sort_by: asString(req.query.sort_by),
                sort_order: asString(req.query.sort_order) as "asc" | "desc" | undefined,
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Day wise report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getDayWiseTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getDayWiseTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Day wise table fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getCouponRedemptionReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getCouponRedemptionReport(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Coupon redemption report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

async getCouponRedemptionTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getCouponRedemptionTable(
            salonId,
            {
                from: asString(req.query.from),
                to: asString(req.query.to),
            }
        );

        sendSuccess(
            res,
            200,
            data,
            "Coupon redemption table fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},


// ======================================================
// INDEPENDENT REPORT APIs — POST /api/report/*
// Read sales/sale_items/payments/appointments directly via SQL, never
// through the legacy handlers above or the Appointment HTTP API/service.
// ======================================================

async getSalesSummaryReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            staff_id: asString(body.staff_id),
            search: asString(body.search),
            status: asString(body.status),
            category_id: asString(body.category_id),
            payment_mode: asString(body.payment_mode),
            item_type: asString(body.item_type),
            service_id: asString(body.service_id),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getSalesSummaryReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Sales summary report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

async getSaleDetail(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const data = await reportsService.getSaleDetail(salonId, String(req.params.saleId));

        if (!data.sale) {
            throw new AppError(404, "Sale not found", "NOT_FOUND");
        }

        sendSuccess(
            res,
            200,
            data,
            "Sale detail fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// DAILY SHEET REPORT (independent report API)
// POST /api/report/daily-sheet
// ======================================================

async getDailySheetReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            date: asString(body.date),
            service_id: asString(body.service_id),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            search: asString(body.search),
            payment_mode: asString(body.payment_mode),
            status: asString(body.status),
            item_type: asString(body.item_type),
            time_from: asString(body.time_from),
            time_to: asString(body.time_to),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getDailySheetReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Daily sheet report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// PRODUCT RETAIL REPORT (independent report API)
// POST /api/report/product-retail
// ======================================================

async getProductRetailReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            product_id: asString(body.product_id),
            search: asString(body.search),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            brand_id: asString(body.brand_id),
            category_id: asString(body.category_id),
            min_price: body.min_price !== undefined ? Number(body.min_price) : undefined,
            max_price: body.max_price !== undefined ? Number(body.max_price) : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getProductRetailReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Product retail report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// SERVICE SALE REPORT (independent report API)
// POST /api/report/service-sale
// ======================================================

async getServiceSaleReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            category_id: asString(body.category_id),
            service_id: asString(body.service_id),
            min_price: body.min_price !== undefined ? Number(body.min_price) : undefined,
            max_price: body.max_price !== undefined ? Number(body.max_price) : undefined,
            payment_method: asString(body.payment_method),
            search: asString(body.search),
            sort_by: asString(body.sort_by) as
                | "date" | "invoice_no" | "service_name" | "staff_name" | "price" | "total"
                | undefined,
            sort_dir: asString(body.sort_dir) as "asc" | "desc" | undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getServiceSaleReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Service sale report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// GST / TAXES REPORT (independent report API)
// POST /api/report/gst
// ======================================================

async getGstReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            search: asString(body.search),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getGstReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "GST report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// PRODUCT INVENTORY SALES (independent report API)
// POST /api/report/product-inventory-sales
// Per-product units-sold + tax-inclusive revenue, keyed by product_id, for
// the Product Inventory report's "Sales" column.
// ======================================================

async getProductInventorySales(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};
        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
        };
        const data = await reportsService.getProductInventorySales(salonId, filters);
        sendSuccess(res, 200, data, "Product inventory sales fetched successfully");
    } catch (err) {
        next(err);
    }
},

// ======================================================
// PRODUCT MARGIN REPORT (independent report API)
// POST /api/report/product-margin
// ======================================================

async getProductMarginReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getProductMarginReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Product margin report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// REWARD POINTS REPORT (independent report API)
// POST /api/report/reward-points
// ======================================================

async getRewardPointsReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const numOrUndefined = (v: unknown) => v !== undefined && v !== null && v !== "" ? Number(v) : undefined;
        const filters = {
            search: asString(body.search),
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            status: asString(body.status) as any,
            points_available_min: numOrUndefined(body.points_available_min),
            points_available_max: numOrUndefined(body.points_available_max),
            points_redeemed_min: numOrUndefined(body.points_redeemed_min),
            points_redeemed_max: numOrUndefined(body.points_redeemed_max),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getRewardPointsReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Reward points report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// E-WALLET REPORT (independent report API)
// POST /api/report/ewallet
// ======================================================

async getEwalletReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            search: asString(body.search),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getEwalletReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "E-wallet report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// CLIENT REVENUE REPORT (independent report API)
// POST /api/report/client-revenue
// ======================================================

async getClientRevenueReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            search: asString(body.search),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getClientRevenueReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Client revenue report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// STAFF SALES REPORT (independent report API)
// POST /api/report/staff-sales
// ======================================================

async getStaffSalesReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            staff_id: asString(body.staff_id),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            search: asString(body.search),
            page: body.page != null ? Number(body.page) : undefined,
            limit: body.limit != null ? Number(body.limit) : undefined,
        };

        const data = await reportsService.getStaffSalesReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Staff sales report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// STAFF ITEM SALES REPORT (independent report API)
// POST /api/report/staff-item-sales
// ======================================================

async getStaffItemSalesReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const itemType = asString(body.item_type);
        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            item_type: (["service", "product", "membership", "package"].includes(itemType ?? "")
                ? itemType : "service") as "service" | "product" | "membership" | "package",
            staff_id: asString(body.staff_id),
            search: asString(body.search),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getStaffItemSalesReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Staff item sales report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// PACKAGE SALE REPORT (independent report API)
// POST /api/report/package-sale
// ======================================================

async getPackageSaleReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            search: asString(body.search),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            package_name: asString(body.package_name),
            package_status: asString(body.package_status),
            payment_status: asString(body.payment_status),
            payment_method: asString(body.payment_method),
            min_amount: body.min_amount !== undefined ? Number(body.min_amount) : undefined,
            max_amount: body.max_amount !== undefined ? Number(body.max_amount) : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getPackageSaleReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Package sale report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// POST /api/report/package-history
// ======================================================

async getPackageHistoryReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            search: asString(body.search),
            package_name: asString(body.package_name),
            service_name: asString(body.service_name),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            status: asString(body.status) as any,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getPackageHistoryReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Package history report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// MEMBER SALE REPORT (independent report API)
// POST /api/report/member-sale
// ======================================================

async getMemberSaleReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            search: asString(body.search),
            status: asString(body.status) as any,
            membership_id: asString(body.membership_id),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            pricing_type: asString(body.pricing_type),
            price_min: body.price_min !== undefined && body.price_min !== null && body.price_min !== ""
                ? Number(body.price_min) : undefined,
            price_max: body.price_max !== undefined && body.price_max !== null && body.price_max !== ""
                ? Number(body.price_max) : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getMemberSaleReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Member sale report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// APPOINTMENT DETAIL REPORT (independent report API)
// POST /api/report/appointment-detail
// ======================================================

async getAppointmentDetailReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            from: asString(body.from),
            to: asString(body.to),
            statuses: Array.isArray(body.statuses)
                ? body.statuses.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getAppointmentDetailReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Appointment detail report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

};
