import crypto from "crypto";
import { AppError } from "../../middleware/error.middleware";
import { bookingsRepository } from "./bookings.repository";
import { clientsRepository } from "../clients/clients.repository";
import { generateUniqueReferralCode } from "../clients/clients.service";
import { notificationsService } from "../notifications/notifications.service";
import { appointmentsService } from "../appointments/appointments.service";
import { appointmentsRepository } from "../appointments/appointments.repository";
import { blockedTimesRepository } from "../blocked_times/blocked_times.repository";
import { groupWorkingHours } from "../marketplace/marketplace.service";
import { reviewsService } from "../reviews/reviews.service";
import { PublicBookingRequest } from "./bookings.types";
import logger from "../../config/logger";

// Attaches the salon's real marketplace working hours/amenities and real
// review data so the public booking page shows actual data instead of always
// falling back to its hardcoded placeholder defaults (4.8 rating, sample
// reviews, generic amenities).
async function attachPublicExtras(salon: any) {
    const [marketplaceExtras, reviewSummary, bookingPolicy] = await Promise.all([
        salon?.marketplace_profile_id
            ? Promise.all([
                bookingsRepository.findWorkingHours(salon.marketplace_profile_id),
                bookingsRepository.findAmenities(salon.marketplace_profile_id),
            ]).then(([hourRows, amenities]) => ({ working_hours: groupWorkingHours(hourRows), amenities }))
            : Promise.resolve({}),
        reviewsService.getPublicSummary(salon.id),
        bookingsRepository.findBookingPolicy(salon.id),
    ]);
    return {
        ...salon,
        ...marketplaceExtras,
        ...bookingPolicy,
        rating: reviewSummary.averageRating,
        review_count: reviewSummary.totalReviews,
        rating_breakdown: reviewSummary.breakdown,
        reviews: reviewSummary.reviews,
    };
}

// ── Availability ─────────────────────────────────────────────────────────────
// Real slot generation for the public booking page, replacing what used to be
// a pure hash-of-the-date fake list with no relation to actual bookings.

const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + (m || 0);
};

function fmt12h(totalMinutes: number): string {
    const h24 = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const ampm = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Shared by computeAvailableSlots (what the UI is offered) and createBooking's
// server-side re-check (what a submitted time is validated against) — both
// must agree on what "working that day" means, per staff, per date.
async function getStaffWindowsForDate(
    salonId: string,
    staffIds: string[],
    dateStr: string
): Promise<{ windowByStaff: Map<string, { open: number; close: number }>; stepMin: number }> {
    const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();

    const [scheduleRows, staffWithAnySchedule, marketplaceDayHours] = await Promise.all([
        bookingsRepository.findStaffScheduleForDate(staffIds, dateStr, dayOfWeek),
        bookingsRepository.findStaffIdsWithAnySchedule(staffIds),
        bookingsRepository.findMarketplaceDayHours(salonId, dayOfWeek),
    ]);
    const scheduleByStaff = new Map(scheduleRows.map((r) => [r.staff_id as string, r]));

    // Fallback window only for staff who've never configured Staff Schedule
    // at all — a configured staff member with no row for this specific day
    // means they don't work that day, not "ask the salon's general hours."
    // `marketplaceDayHours === null` means no row for this day exists at all
    // (salon never set up Marketplace hours) — default to 9-6 rather than
    // leaving an unconfigured salon+staff combo with zero availability.
    // `is_open === false` means the salon explicitly closes that day — no
    // fallback window at all in that case.
    const salonOpen =
        marketplaceDayHours === null ? { open_time: "09:00", close_time: "18:00", slot_interval_minutes: 15 }
        : marketplaceDayHours.is_open === false ? null
        : marketplaceDayHours;
    const stepMin = salonOpen?.slot_interval_minutes ?? 15;

    // Each staff member's own [open, close) window in minutes-from-midnight
    // for this exact date, or absent if they're not working at all that day.
    const windowByStaff = new Map<string, { open: number; close: number }>();
    for (const id of staffIds) {
        const row = scheduleByStaff.get(id);
        if (row) {
            if (!row.is_available || !row.start_time || !row.end_time) continue; // explicit day off
            windowByStaff.set(id, { open: toMinutes(String(row.start_time).slice(0, 5)), close: toMinutes(String(row.end_time).slice(0, 5)) });
        } else if (!staffWithAnySchedule.has(id) && salonOpen) {
            // Never configured — fall back to the salon's general hours.
            windowByStaff.set(id, { open: toMinutes(salonOpen.open_time), close: toMinutes(salonOpen.close_time) });
        }
        // else: staff has a schedule elsewhere but nothing for this day/date — not working.
    }
    return { windowByStaff, stepMin };
}

async function computeAvailableSlots(params: {
    salonId: string;
    dateStr: string;
    staffId?: string;
    durationMinutes: number;
}): Promise<string[]> {
    const { salonId, dateStr, staffId, durationMinutes } = params;

    const [staffList, appointments, blockedTimes] = await Promise.all([
        staffId ? Promise.resolve([{ id: staffId }]) : bookingsRepository.findActiveStaff(salonId),
        bookingsRepository.findAppointmentsForDate(salonId, dateStr),
        blockedTimesRepository.list({ salon_id: salonId, date: dateStr }),
    ]);
    if (staffList.length === 0) return [];

    const staffIds = staffList.map((s) => s.id);
    const { windowByStaff, stepMin } = await getStaffWindowsForDate(salonId, staffIds, dateStr);
    if (windowByStaff.size === 0) return [];

    // Per-staff busy [start, end) ranges in minutes-from-midnight (UTC, matching
    // how scheduled_at is written for public bookings — see createBooking above).
    const busyByStaff = new Map<string, Array<{ start: number; end: number }>>();
    const addBusy = (id: string | null | undefined, start: number, end: number) => {
        if (!id) return;
        if (!busyByStaff.has(id)) busyByStaff.set(id, []);
        busyByStaff.get(id)!.push({ start, end });
    };
    for (const appt of appointments) {
        const d = new Date(appt.scheduled_at);
        const start = d.getUTCHours() * 60 + d.getUTCMinutes();
        addBusy(appt.staff_id, start, start + (Number(appt.duration_minutes) || 30));
    }
    for (const b of blockedTimes) {
        addBusy(b.staff_id, toMinutes(String(b.start_time).slice(0, 5)), toMinutes(String(b.end_time).slice(0, 5)));
    }

    const isStaffFreeAt = (id: string, start: number, end: number): boolean => {
        const win = windowByStaff.get(id);
        if (!win || start < win.open || end > win.close) return false;
        return !(busyByStaff.get(id) ?? []).some((r) => start < r.end && end > r.start);
    };

    const overallOpen  = Math.min(...Array.from(windowByStaff.values()).map((w) => w.open));
    const overallClose = Math.max(...Array.from(windowByStaff.values()).map((w) => w.close));

    const slots: string[] = [];
    for (let start = overallOpen; start + durationMinutes <= overallClose; start += stepMin) {
        const end = start + durationMinutes;
        const anyStaffFree = staffIds.some((id) => isStaffFreeAt(id, start, end));
        if (anyStaffFree) slots.push(fmt12h(start));
    }
    return slots;
}

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

        const [services, staff, fullSalon] = await Promise.all([
            bookingsRepository.findActiveServices(salon.id),
            bookingsRepository.findActiveStaff(salon.id),
            attachPublicExtras(salon),
        ]);

        return { salon: fullSalon, services, staff };
    },

    async getSalonDetails(salon_id: string) {
        const salon = await bookingsRepository.findSalonById(salon_id);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const [services, staff, fullSalon] = await Promise.all([
            bookingsRepository.findActiveServices(salon_id),
            bookingsRepository.findActiveStaff(salon_id),
            attachPublicExtras(salon),
        ]);

        return { salon: fullSalon, services, staff };
    },

    async getAvailability(params: { salon_id: string; date: string; staffId?: string; durationMinutes?: number }) {
        const salon = await bookingsRepository.findSalonById(params.salon_id);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        const slots = await computeAvailableSlots({
            salonId: params.salon_id,
            dateStr: params.date,
            staffId: params.staffId,
            durationMinutes: Math.max(15, Number(params.durationMinutes) || 30),
        });
        return { slots };
    },

    async createBooking(body: PublicBookingRequest) {
        // findSalonById already excludes inactive/unpublished salons — reject
        // up front instead of letting an unpublished salon still take bookings
        // via a direct link (the marketplace Unpublish toggle must actually work).
        const salon = await bookingsRepository.findSalonById(body.salon_id);
        if (!salon) throw new AppError(404, "This salon is not accepting online bookings", "NOT_FOUND");

        const services = await Promise.all(
            body.service_ids.map((id) => bookingsRepository.findServiceById(id, body.salon_id))
        );
        if (services.some((s) => !s)) {
            throw new AppError(404, "Service not found for this salon", "NOT_FOUND");
        }

        if (body.staff_id) {
            const staff = await bookingsRepository.findStaffById(body.staff_id, body.salon_id);
            if (!staff) throw new AppError(404, "Staff member not found for this salon", "NOT_FOUND");

            // Mirror the same blocked-time guard the internal staff-facing booking
            // flow enforces (appointments.service.ts) — public self-service booking
            // must not be able to schedule over a stylist's declared time off.
            const durationMinutes = services.reduce((sum, s) => sum + (Number(s!.duration) || 30), 0);
            const apptDate = new Date(body.scheduled_at);
            const dateStr  = apptDate.toISOString().slice(0, 10);
            const pad = (n: number) => String(n).padStart(2, "0");
            const startStr = `${pad(apptDate.getUTCHours())}:${pad(apptDate.getUTCMinutes())}`;
            const endDate  = new Date(apptDate.getTime() + durationMinutes * 60_000);
            const endStr   = `${pad(endDate.getUTCHours())}:${pad(endDate.getUTCMinutes())}`;

            const blocked = await blockedTimesRepository.hasOverlap({
                staffId: body.staff_id,
                date: dateStr,
                startTime: startStr,
                endTime: endStr,
            });
            if (blocked) {
                throw new AppError(409, "This time is no longer available for the selected staff member.", "BLOCKED_TIME");
            }

            // Re-validate against the staff member's actual working hours for this
            // date — the same check computeAvailableSlots uses to build the list the
            // client picked from, so a stale slot list (or a direct API call) can't
            // book outside it.
            const { windowByStaff } = await getStaffWindowsForDate(body.salon_id, [body.staff_id], dateStr);
            const win = windowByStaff.get(body.staff_id);
            const startMin = toMinutes(startStr);
            const endMin = toMinutes(endStr);
            if (!win || startMin < win.open || endMin > win.close) {
                throw new AppError(409, "This staff member is not working at the selected time.", "OUTSIDE_WORKING_HOURS");
            }
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
        } else if (client.is_blocked) {
            // The actual point of "Block" (Clients page) — a blocked client can
            // still be booked in-person by staff (that flow doesn't go through
            // here), just not through public online booking.
            throw new AppError(403, "This client is blocked from booking online. Please contact the salon directly.", "CLIENT_BLOCKED");
        }

        const durationMinutes = services.reduce((sum, s) => sum + (Number(s!.duration) || 30), 0);
        const title = services.map((s) => s!.name).join(", ");

        const appointment = await bookingsRepository.createAppointment({
            salonId: body.salon_id,
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
