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
// SALES SUMMARY REPORT (independent report API)
// POST /api/report/sales-summary
// GET  /api/report/sales-summary/:saleId
// ======================================================

export const reportsController = {

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
            staff_id: asString(body.staff_id),
            search: asString(body.search),
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
            staff_id: asString(body.staff_id),
            search: asString(body.search),
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
            staff_id: asString(body.staff_id),
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

        const filters = {
            search: asString(body.search),
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

        const period = asString(body.period);
        const filters = {
            start_date: asString(body.start_date),
            end_date: asString(body.end_date),
            period: (period === "weekly" || period === "monthly" || period === "yearly" ? period : "daily") as
                "daily" | "weekly" | "monthly" | "yearly",
            staff_id: asString(body.staff_id),
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
