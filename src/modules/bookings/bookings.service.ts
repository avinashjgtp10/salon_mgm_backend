import crypto from "crypto";
import { AppError } from "../../middleware/error.middleware";
import { bookingsRepository } from "./bookings.repository";
import { branchesRepository } from "../branches/branches.repository";
import { clientsRepository } from "../clients/clients.repository";
import { generateUniqueReferralCode } from "../clients/clients.service";
import { notificationsService } from "../notifications/notifications.service";
import { appointmentsService } from "../appointments/appointments.service";
import { appointmentsRepository } from "../appointments/appointments.repository";
import { PublicBookingRequest } from "./bookings.types";
import logger from "../../config/logger";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", year: "numeric",
    });
}

function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit", minute: "2-digit", hour12: true,
    });
}

// Signs a per-appointment management token so a client can cancel/reschedule
// their own booking from the confirmation link/email without an account —
// no extra column needed, the token is just an HMAC of the appointment id.
const MANAGE_TOKEN_SECRET =
    process.env.BOOKING_MANAGE_SECRET || process.env.JWT_ACCESS_SECRET || "dev-booking-manage-secret";

function generateManageToken(appointmentId: string): string {
    return crypto.createHmac("sha256", MANAGE_TOKEN_SECRET).update(appointmentId).digest("hex");
}

function assertManageToken(appointmentId: string, token: string | undefined | null) {
    const expected = generateManageToken(appointmentId);
    const provided = Buffer.from(String(token || ""));
    const expectedBuf = Buffer.from(expected);
    const valid =
        provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);
    if (!valid) throw new AppError(403, "Invalid or expired management link", "FORBIDDEN");
}

export const bookingsService = {
    async getSalonBySlug(slug: string) {
        const salon = await bookingsRepository.findSalonBySlug(slug);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const [services, staff] = await Promise.all([
            bookingsRepository.findActiveServices(salon.id),
            bookingsRepository.findActiveStaff(salon.id),
        ]);

        return { salon, services, staff };
    },

    async getSalonDetails(salon_id: string) {
        const salon = await bookingsRepository.findSalonById(salon_id);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const [services, staff] = await Promise.all([
            bookingsRepository.findActiveServices(salon_id),
            bookingsRepository.findActiveStaff(salon_id),
        ]);

        return { salon, services, staff };
    },

    async createBooking(body: PublicBookingRequest) {
        const services = await Promise.all(
            body.service_ids.map((id) => bookingsRepository.findServiceById(id, body.salon_id))
        );
        if (services.some((s) => !s)) {
            throw new AppError(404, "Service not found for this salon", "NOT_FOUND");
        }

        if (body.staff_id) {
            const staff = await bookingsRepository.findStaffById(body.staff_id, body.salon_id);
            if (!staff) throw new AppError(404, "Staff member not found for this salon", "NOT_FOUND");
        }

        // Find or create the client for this salon
        let client = await clientsRepository.findExistingByEmailOrPhone(
            { email: body.client_email, phone_number: body.client_phone },
            body.salon_id
        );

        if (!client) {
            const nameParts = body.client_name.trim().split(/\s+/);
            const referralCode = await generateUniqueReferralCode(nameParts[0], body.salon_id);
            client = await clientsRepository.create(
                {
                    first_name: nameParts[0],
                    last_name: nameParts.slice(1).join(" ") || null,
                    email: body.client_email || null,
                    phone_number: body.client_phone || null,
                },
                body.salon_id,
                { code: referralCode, rewardStatus: null }
            );
        }

        const durationMinutes = services.reduce((sum, s) => sum + (Number(s!.duration) || 30), 0);
        const title = services.map((s) => s!.name).join(", ");

        // Public booking requests don't collect a branch, so default the same
        // way staff-created appointments do (appointments.service.ts) — otherwise
        // the appointment is left without a branch_id and later fails consumable
        // deduction at checkout with BRANCH_REQUIRED.
        const branches = await branchesRepository.listBySalonId(body.salon_id);
        const branchId = branches.find((branch) => branch.is_main)?.id ?? branches[0]?.id ?? null;

        const appointment = await bookingsRepository.createAppointment({
            salonId: body.salon_id,
            branchId,
            clientId: client.id,
            staffId: body.staff_id || null,
            serviceId: body.service_ids[0],
            title,
            scheduledAt: body.scheduled_at,
            durationMinutes,
            notes: body.notes || null,
            services: services.map((s, i) => ({
                service_id: body.service_ids[i],
                name: s!.name,
                price: Number(s!.price) || 0,
                quantity: 1,
                staff_id: body.staff_id || null,
            })),
        });

        // Live calendar update — the dashboard calendar refreshes on this same
        // socket event used for staff-created appointments (appointments.service.ts).
        notificationsService.create({
            salon_id: body.salon_id,
            type: "appointment",
            title: "New Appointment Booked",
            body: `${body.client_name} — ${formatDate(body.scheduled_at)} at ${formatTime(body.scheduled_at)}`,
        }).catch((err: any) => {
            logger.error("Public booking notification failed", {
                appointmentId: appointment.id,
                salonId: body.salon_id,
                message: err?.message,
                stack: err?.stack,
                error: err,
            });
        });

        return { ...appointment, manage_token: generateManageToken(appointment.id) };
    },

    // ── Client self-service: manage a booking via its signed link ─────────────

    async getManagedAppointment(appointmentId: string, token: string | undefined | null) {
        assertManageToken(appointmentId, token);
        const appointment = await appointmentsRepository.findById(appointmentId);
        if (!appointment) throw new AppError(404, "Booking not found", "NOT_FOUND");
        return appointment;
    },

    async cancelManagedAppointment(appointmentId: string, token: string | undefined | null) {
        assertManageToken(appointmentId, token);
        return appointmentsService.cancel({
            appointmentId,
            requesterUserId: "public-client",
            body: {},
        });
    },

    async rescheduleManagedAppointment(
        appointmentId: string,
        token: string | undefined | null,
        scheduled_at: string
    ) {
        assertManageToken(appointmentId, token);
        return appointmentsService.update({
            appointmentId,
            requesterUserId: "public-client",
            patch: { scheduled_at },
        });
    },
};
