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
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            search: asString(body.search),
            status: asString(body.status),
            category_id: asString(body.category_id),
            category_ids: Array.isArray(body.category_ids)
                ? body.category_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            payment_mode: asString(body.payment_mode),
            payment_modes: Array.isArray(body.payment_modes)
                ? body.payment_modes.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            item_type: asString(body.item_type),
            item_types: Array.isArray(body.item_types)
                ? body.item_types.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            service_id: asString(body.service_id),
            service_ids: Array.isArray(body.service_ids)
                ? body.service_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            payment_status: asString(body.payment_status),
            payment_statuses: Array.isArray(body.payment_statuses)
                ? body.payment_statuses.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
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
            service_ids: Array.isArray(body.service_ids)
                ? body.service_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            search: asString(body.search),
            payment_mode: asString(body.payment_mode),
            payment_modes: Array.isArray(body.payment_modes)
                ? body.payment_modes.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            status: asString(body.status),
            statuses: Array.isArray(body.statuses)
                ? body.statuses.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            item_type: asString(body.item_type),
            item_types: Array.isArray(body.item_types)
                ? body.item_types.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
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
            brand_ids: Array.isArray(body.brand_ids)
                ? body.brand_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            category_id: asString(body.category_id),
            category_ids: Array.isArray(body.category_ids)
                ? body.category_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
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
            category_ids: Array.isArray(body.category_ids)
                ? body.category_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            service_id: asString(body.service_id),
            service_ids: Array.isArray(body.service_ids)
                ? body.service_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            min_price: body.min_price !== undefined ? Number(body.min_price) : undefined,
            max_price: body.max_price !== undefined ? Number(body.max_price) : undefined,
            payment_method: asString(body.payment_method),
            payment_methods: Array.isArray(body.payment_methods)
                ? body.payment_methods.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
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
            item_types: Array.isArray(body.item_types)
                ? body.item_types.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            payment_methods: Array.isArray(body.payment_methods)
                ? body.payment_methods.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
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
            search: asString(body.search),
            brand_ids: Array.isArray(body.brand_ids)
                ? body.brand_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            category_ids: Array.isArray(body.category_ids)
                ? body.category_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
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
            as_of_date: asString(body.as_of_date),
            status: asString(body.status),
            balance_min: body.balance_min !== undefined ? Number(body.balance_min) : undefined,
            balance_max: body.balance_max !== undefined ? Number(body.balance_max) : undefined,
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
// PRODUCT INVENTORY REPORT (independent report API)
// POST /api/report/product-inventory
// ======================================================

async getProductInventoryReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const filters = {
            search: asString(body.search),
            category_id: asString(body.category_id),
            category_ids: Array.isArray(body.category_ids) ? body.category_ids.map(String) : undefined,
            brand_id: asString(body.brand_id),
            brand_ids: Array.isArray(body.brand_ids) ? body.brand_ids.map(String) : undefined,
            stock_status: (body.stock_status === "in_stock" || body.stock_status === "low_stock" || body.stock_status === "out_of_stock")
                ? body.stock_status
                : undefined,
            date_from: asString(body.date_from),
            date_to: asString(body.date_to),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getProductInventoryReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Product inventory report fetched successfully"
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
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            gender: asString(body.gender),
            membership_status: asString(body.membership_status),
            last_visit_from: asString(body.last_visit_from),
            last_visit_to: asString(body.last_visit_to),
            sort_by: asString(body.sort_by),
            sort_dir: body.sort_dir === "asc" ? "asc" as const : body.sort_dir === "desc" ? "desc" as const : undefined,
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
// CUSTOMER FREQUENCY REPORT (independent report API)
// POST /api/report/customer-frequency
// ======================================================

async getCustomerFrequencyReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const allowedCustomerTypes = ["most_frequent", "least_frequent", "most_spending", "least_spending", "new", "old", "lost"];
        const customerType = asString(body.customer_type);

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            search: asString(body.search),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            customer_type: customerType && allowedCustomerTypes.includes(customerType)
                ? customerType as "most_frequent" | "least_frequent" | "most_spending" | "least_spending" | "new" | "old" | "lost"
                : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getCustomerFrequencyReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Customer frequency report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// LOST CUSTOMERS REPORT (independent report API)
// POST /api/report/lost-customers
// ======================================================

async getLostCustomersReport(
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
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            lost_days: body.lost_days !== undefined ? Number(body.lost_days) : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getLostCustomersReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Lost customers report fetched successfully"
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
            payment_mode: asString(body.payment_mode),
            payment_modes: Array.isArray(body.payment_modes)
                ? body.payment_modes.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            item_type: asString(body.item_type),
            item_types: Array.isArray(body.item_types)
                ? body.item_types.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            payment_status: asString(body.payment_status),
            payment_statuses: Array.isArray(body.payment_statuses)
                ? body.payment_statuses.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            sort: body.sort === "sales_desc" || body.sort === "sales_asc" ? body.sort : undefined,
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
// STAFF PERFORMANCE REPORT (independent report API)
// POST /api/report/staff-performance
// ======================================================

async getStaffPerformanceReport(
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
            branch_id: asString(body.branch_id),
            payment_mode: asString(body.payment_mode),
            payment_modes: Array.isArray(body.payment_modes)
                ? body.payment_modes.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            payment_status: asString(body.payment_status),
            payment_statuses: Array.isArray(body.payment_statuses)
                ? body.payment_statuses.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            item_type: asString(body.item_type),
            item_types: Array.isArray(body.item_types)
                ? body.item_types.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            service_id: asString(body.service_id),
            product_id: asString(body.product_id),
            package_id: asString(body.package_id),
            package_ids: Array.isArray(body.package_ids)
                ? body.package_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            membership_id: asString(body.membership_id),
            membership_ids: Array.isArray(body.membership_ids)
                ? body.membership_ids.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            search: asString(body.search),
            page: body.page != null ? Number(body.page) : undefined,
            limit: body.limit != null ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getStaffPerformanceReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Staff performance report fetched successfully"
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
            staff_ids: Array.isArray(body.staff_ids) ? body.staff_ids.map(String) : undefined,
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
            package_names: Array.isArray(body.package_names) ? body.package_names.map(String) : undefined,
            package_status: asString(body.package_status),
            package_statuses: Array.isArray(body.package_statuses) ? body.package_statuses.map(String) : undefined,
            payment_status: asString(body.payment_status),
            payment_statuses: Array.isArray(body.payment_statuses) ? body.payment_statuses.map(String) : undefined,
            payment_method: asString(body.payment_method),
            payment_methods: Array.isArray(body.payment_methods) ? body.payment_methods.map(String) : undefined,
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
            package_names: Array.isArray(body.package_names) ? body.package_names.map(String) : undefined,
            service_name: asString(body.service_name),
            service_names: Array.isArray(body.service_names) ? body.service_names.map(String) : undefined,
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            status: asString(body.status) as any,
            statuses: Array.isArray(body.statuses) ? body.statuses.map(String) : undefined,
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
            statuses: Array.isArray(body.statuses) ? body.statuses.map(String) : undefined,
            membership_id: asString(body.membership_id),
            membership_ids: Array.isArray(body.membership_ids) ? body.membership_ids.map(String) : undefined,
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            pricing_type: asString(body.pricing_type),
            pricing_types: Array.isArray(body.pricing_types) ? body.pricing_types.map(String) : undefined,
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
            search: asString(body.search),
            payment_methods: Array.isArray(body.payment_methods)
                ? body.payment_methods.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
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

// ======================================================
// WA MARKETING CAMPAIGN REPORT (independent report API)
// POST /api/report/wa-campaign
// ======================================================

async getWaCampaignReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const validBuckets = ["high", "medium", "low", "none"];

        const filters = {
            search: asString(body.search),
            statuses: Array.isArray(body.statuses)
                ? body.statuses.filter((s: unknown) => typeof s === "string" && s.trim() !== "")
                : undefined,
            template_ids: Array.isArray(body.template_ids)
                ? body.template_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            date_from: asString(body.date_from),
            date_to: asString(body.date_to),
            delivery_bucket: validBuckets.includes(body.delivery_bucket) ? body.delivery_bucket : undefined,
            read_bucket: validBuckets.includes(body.read_bucket) ? body.read_bucket : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getWaCampaignReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "WA campaign report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

// ======================================================
// OPEN RATE REPORT (independent report API)
// POST /api/report/open-rate          — summary + campaign rows + trend
// POST /api/report/open-rate/campaign — one campaign's drill-down
// ======================================================

async getOpenRateReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const asStringArray = (v: unknown): string[] | undefined =>
            Array.isArray(v)
                ? v.map((x) => String(x)).filter((x) => x.trim() !== "")
                : undefined;

        const VALID_CHANNELS = ["whatsapp", "sms", "email"];
        const channels = asStringArray(body.channels)?.filter((c) => VALID_CHANNELS.includes(c));

        const filters = {
            search: asString(body.search),
            campaign_ids: asStringArray(body.campaign_ids),
            message_statuses: asStringArray(body.message_statuses),
            campaign_statuses: asStringArray(body.campaign_statuses),
            channels: channels as ("whatsapp" | "sms" | "email")[] | undefined,
            date_from: asString(body.date_from),
            date_to: asString(body.date_to),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
            sort_by: asString(body.sort_by),
            sort_dir: body.sort_dir === "asc" ? ("asc" as const) : ("desc" as const),
        };

        const data = await reportsService.getOpenRateReport(salonId, filters);

        sendSuccess(res, 200, data, "Open rate report fetched successfully");
    } catch (error) {
        next(error);
    }
},

async getOpenRateCampaignDetail(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};
        const campaignId = asString(body.campaign_id);
        if (!campaignId) {
            res.status(400).json({ success: false, message: "campaign_id is required" });
            return;
        }

        const data = await reportsService.getOpenRateCampaignDetail(salonId, campaignId, {
            status: asString(body.status),
            search: asString(body.search),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
        });

        if (!data) {
            res.status(404).json({ success: false, message: "Campaign not found" });
            return;
        }

        sendSuccess(res, 200, data, "Campaign detail fetched successfully");
    } catch (error) {
        next(error);
    }
},

// ======================================================
// REPLY RATE REPORT (independent report API)
// POST /api/report/reply-rate          — summary + campaign rows
// POST /api/report/reply-rate/campaign — one campaign's recipients
// ======================================================

async getReplyRateReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const asStringArray = (v: unknown): string[] | undefined =>
            Array.isArray(v)
                ? v.map((x) => String(x)).filter((x) => x.trim() !== "")
                : undefined;

        const VALID_CHANNELS = ["whatsapp", "sms", "email"];
        const channels = asStringArray(body.channels)?.filter((c) => VALID_CHANNELS.includes(c));

        const filters = {
            search: asString(body.search),
            campaign_ids: asStringArray(body.campaign_ids),
            message_statuses: asStringArray(body.message_statuses),
            campaign_statuses: asStringArray(body.campaign_statuses),
            channels: channels as ("whatsapp" | "sms" | "email")[] | undefined,
            date_from: asString(body.date_from),
            date_to: asString(body.date_to),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
            sort_by: asString(body.sort_by),
            sort_dir: body.sort_dir === "asc" ? ("asc" as const) : ("desc" as const),
        };

        const data = await reportsService.getReplyRateReport(salonId, filters);

        sendSuccess(res, 200, data, "Reply rate report fetched successfully");
    } catch (error) {
        next(error);
    }
},

async getReplyRateCampaignDetail(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};
        const campaignId = asString(body.campaign_id);
        if (!campaignId) {
            res.status(400).json({ success: false, message: "campaign_id is required" });
            return;
        }

        const data = await reportsService.getReplyRateCampaignDetail(salonId, campaignId, {
            replied: body.replied === "yes" ? "yes" : body.replied === "no" ? "no" : undefined,
            search: asString(body.search),
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
        });

        if (!data) {
            res.status(404).json({ success: false, message: "Campaign not found" });
            return;
        }

        sendSuccess(res, 200, data, "Campaign reply detail fetched successfully");
    } catch (error) {
        next(error);
    }
},

// ======================================================
// CLIENT RATING REPORT (independent report API)
// POST /api/report/client-rating
// ======================================================

async getClientRatingReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);
        const body = req.body ?? {};

        const allowedMinRatings = [1, 2, 3, 4, 5];
        const minRatingNum = body.min_rating !== undefined ? Number(body.min_rating) : undefined;

        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            search: asString(body.search),
            staff_ids: Array.isArray(body.staff_ids)
                ? body.staff_ids.map((v: unknown) => String(v)).filter(Boolean)
                : undefined,
            min_rating: minRatingNum !== undefined && allowedMinRatings.includes(minRatingNum)
                ? minRatingNum
                : undefined,
            page: body.page !== undefined ? Number(body.page) : undefined,
            limit: body.limit !== undefined ? Number(body.limit) : undefined,
            is_export: body.is_export === true,
        };

        const data = await reportsService.getClientRatingReport(salonId, filters);

        sendSuccess(
            res,
            200,
            data,
            "Client rating report fetched successfully"
        );
    } catch (error) {
        next(error);
    }
},

};
