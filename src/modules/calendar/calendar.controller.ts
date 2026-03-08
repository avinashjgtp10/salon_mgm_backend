import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { calendarService } from "./calendar.service";
import {
    CreateAppointmentBody,
    UpdateAppointmentBody,
    CancelAppointmentBody,
    CheckoutAppointmentBody,
    ListAppointmentsFilters,
    AppointmentStatus,
} from "./calendar.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string };
};

export const calendarController = {

    // POST /api/v1/appointments
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;

            logger.info("POST /appointments called", { userId, role, path: req.originalUrl, method: req.method });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const appointment = await calendarService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body as CreateAppointmentBody,
            });

            sendSuccess(res, 201, appointment, "Appointment created successfully");
        } catch (err) {
            logger.error("POST /appointments error", { err });
            next(err);
        }
    },

    // GET /api/v1/appointments/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();

            logger.info("GET /appointments/:id called", { id, path: req.originalUrl, method: req.method });

            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const appointment = await calendarService.getById(id);

            sendSuccess(res, 200, appointment, "Appointment fetched successfully");
        } catch (err) {
            logger.error("GET /appointments/:id error", { err });
            next(err);
        }
    },

    // GET /api/v1/appointments
    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            logger.info("GET /appointments called", {
                requesterUserId: req.user?.userId,
                query: req.query,
                path: req.originalUrl,
                method: req.method,
            });

            const filters: ListAppointmentsFilters = {
                salon_id: req.query.salon_id as string | undefined,
                branch_id: req.query.branch_id as string | undefined,
                client_id: req.query.client_id as string | undefined,
                staff_id: req.query.staff_id as string | undefined,
                status: req.query.status as AppointmentStatus | undefined,
                date: req.query.date as string | undefined,
                from: req.query.from as string | undefined,
                to: req.query.to as string | undefined,
                page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
            };

            const result = await calendarService.list(filters);

            sendSuccess(res, 200, result, "Appointments fetched successfully");
        } catch (err) {
            logger.error("GET /appointments error", { err });
            next(err);
        }
    },

    // PATCH /api/v1/appointments/:id
    async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();

            logger.info("PATCH /appointments/:id called", { id, userId, role, path: req.originalUrl, method: req.method });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const updated = await calendarService.update({
                appointmentId: id,
                requesterUserId: userId,
                requesterRole: role,
                patch: req.body as UpdateAppointmentBody,
            });

            sendSuccess(res, 200, updated, "Appointment updated successfully");
        } catch (err) {
            logger.error("PATCH /appointments/:id error", { err });
            next(err);
        }
    },

    // POST /api/v1/appointments/:id/confirm
    async confirm(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            logger.info("POST /appointments/:id/confirm called", { id, path: req.originalUrl });
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendarService.confirm(id);
            sendSuccess(res, 200, updated, "Appointment confirmed successfully");
        } catch (err) {
            logger.error("POST /appointments/:id/confirm error", { err });
            next(err);
        }
    },

    // POST /api/v1/appointments/:id/start
    async start(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            logger.info("POST /appointments/:id/start called", { id, path: req.originalUrl });
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendarService.start(id);
            sendSuccess(res, 200, updated, "Appointment started successfully");
        } catch (err) {
            logger.error("POST /appointments/:id/start error", { err });
            next(err);
        }
    },

    // POST /api/v1/appointments/:id/cancel
    async cancel(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            logger.info("POST /appointments/:id/cancel called", { id, path: req.originalUrl });
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendarService.cancel(id, req.body as CancelAppointmentBody);
            sendSuccess(res, 200, updated, "Appointment cancelled successfully");
        } catch (err) {
            logger.error("POST /appointments/:id/cancel error", { err });
            next(err);
        }
    },

    // POST /api/v1/appointments/:id/no-show
    async noShow(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const id = String(req.params.id || "").trim();
            logger.info("POST /appointments/:id/no-show called", { id, path: req.originalUrl });
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendarService.noShow(id);
            sendSuccess(res, 200, updated, "Appointment marked as no-show");
        } catch (err) {
            logger.error("POST /appointments/:id/no-show error", { err });
            next(err);
        }
    },

    // POST /api/v1/appointments/:id/checkout
    async checkout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();

            logger.info("POST /appointments/:id/checkout called", { id, userId, path: req.originalUrl, method: req.method });

            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const result = await calendarService.checkout({
                appointmentId: id,
                requesterUserId: userId,
                body: req.body as CheckoutAppointmentBody,
            });

            sendSuccess(res, 200, result, "Checkout completed successfully");
        } catch (err) {
            logger.error("POST /appointments/:id/checkout error", { err });
            next(err);
        }
    },
};
