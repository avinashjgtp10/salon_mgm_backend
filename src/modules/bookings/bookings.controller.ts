import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { bookingsService } from "./bookings.service";
import { PublicBookingRequest } from "./bookings.types";

export const bookingsController = {
    async getSalonDetails(req: Request, res: Response, next: NextFunction) {
        try {
            const { salon_id } = req.params;
            if (!salon_id) throw new AppError(400, "Salon ID is required", "VALIDATION_ERROR");
            const details = await bookingsService.getSalonDetails(salon_id as string);
            return sendSuccess(res, 200, details, "Salon details fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    async getSalonBySlug(req: Request, res: Response, next: NextFunction) {
        try {
            const { slug } = req.params;
            if (!slug) throw new AppError(400, "Slug is required", "VALIDATION_ERROR");
            const details = await bookingsService.getSalonBySlug(slug as string);
            return sendSuccess(res, 200, details, "Salon details fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    async createBooking(req: Request, res: Response, next: NextFunction) {
        try {
            const body = req.body as PublicBookingRequest;
            if (!body.salon_id || !body.service_ids?.length || !body.scheduled_at || !body.client_name || !body.client_phone) {
                throw new AppError(400, "Missing required booking details", "VALIDATION_ERROR");
            }
            const booking = await bookingsService.createBooking(body);
            return sendSuccess(res, 201, booking, "Booking created successfully");
        } catch (err) {
            return next(err);
        }
    },

    async getManagedBooking(req: Request, res: Response, next: NextFunction) {
        try {
            const appointmentId = req.params.appointmentId as string;
            const token = String(req.query.token || "");
            const appointment = await bookingsService.getManagedAppointment(appointmentId, token);
            return sendSuccess(res, 200, appointment, "Booking fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    async cancelManagedBooking(req: Request, res: Response, next: NextFunction) {
        try {
            const appointmentId = req.params.appointmentId as string;
            const token = String(req.body?.token || req.query.token || "");
            const appointment = await bookingsService.cancelManagedAppointment(appointmentId, token);
            return sendSuccess(res, 200, appointment, "Booking cancelled successfully");
        } catch (err) {
            return next(err);
        }
    },

    async rescheduleManagedBooking(req: Request, res: Response, next: NextFunction) {
        try {
            const appointmentId = req.params.appointmentId as string;
            const token = String(req.body?.token || req.query.token || "");
            const scheduledAt = String(req.body?.scheduled_at || "");
            if (!scheduledAt) throw new AppError(400, "scheduled_at is required", "VALIDATION_ERROR");
            const appointment = await bookingsService.rescheduleManagedAppointment(appointmentId, token, scheduledAt);
            return sendSuccess(res, 200, appointment, "Booking rescheduled successfully");
        } catch (err) {
            return next(err);
        }
    },
};
