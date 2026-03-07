import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { appointmentsService } from "./appointments.service";
import { CreateAppointmentBody, UpdateAppointmentBody, CancelAppointmentBody } from "./appointments.types";

type AuthRequest = Request & { user?: { userId: string; role?: string } };

export const appointmentsController = {

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointmentsService.create({
                requesterUserId: userId, requesterRole: req.user?.role,
                body: req.body as CreateAppointmentBody,
            });
            return sendSuccess(res, 201, appointment, "Appointment created successfully");
        } catch (err) { return next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const appointment = await appointmentsService.getById(id);
            return sendSuccess(res, 200, appointment, "Appointment fetched successfully");
        } catch (err) { return next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const appointments = await appointmentsService.list({
                salonId: String(req.query.salon_id || "").trim() || undefined,
                clientId: String(req.query.client_id || "").trim() || undefined,
                date: String(req.query.date || "").trim() || undefined,
                staffId: String(req.query.staff_id || "").trim() || undefined,
                status: String(req.query.status || "").trim() || undefined,
            });
            return sendSuccess(res, 200, appointments, "Appointments fetched successfully");
        } catch (err) { return next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const appointment = await appointmentsService.update({
                appointmentId: id, requesterUserId: userId,
                requesterRole: req.user?.role, patch: req.body as UpdateAppointmentBody,
            });
            return sendSuccess(res, 200, appointment, "Appointment updated successfully");
        } catch (err) { return next(err); }
    },

    async confirm(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointmentsService.confirm(id);
            return sendSuccess(res, 200, appointment, "Appointment confirmed successfully");
        } catch (err) { return next(err); }
    },

    async start(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointmentsService.start(id);
            return sendSuccess(res, 200, appointment, "Appointment started successfully");
        } catch (err) { return next(err); }
    },

    async cancel(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointmentsService.cancel({
                appointmentId: id, requesterUserId: userId,
                body: req.body as CancelAppointmentBody,
            });
            return sendSuccess(res, 200, appointment, "Appointment cancelled successfully");
        } catch (err) { return next(err); }
    },

    async noShow(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointmentsService.noShow(id);
            return sendSuccess(res, 200, appointment, "Appointment marked as no-show");
        } catch (err) { return next(err); }
    },

    async checkout(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
            const { items, discount_amount, tip_amount, tax_amount, payment_method, notes } = req.body;
            const result = await appointmentsService.checkout({
                appointmentId: id, requesterUserId: userId, requesterRole: req.user?.role,
                saleItems: items, discount_amount, tip_amount, tax_amount, payment_method, notes,
            });
            return sendSuccess(res, 200, result, "Appointment checked out and sale created");
        } catch (err) { return next(err); }
    },
};
