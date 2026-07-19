import { Request, Response, NextFunction } from "express";
import { reportsService } from "./reports.service";
import { sendSuccess } from "../utils/response.util";
import { getSalonId } from "../utils/salon.util";

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

async getStaffCommissionReport(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getStaffCommissionReport(
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
            "Staff commission report fetched successfully"
        );

    } catch (error) {
        next(error);
    }
},

async getStaffCommissionTable(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const salonId = await getSalonId(req);

        const data = await reportsService.getStaffCommissionTable(
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
            "Staff commission table fetched successfully"
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

};
