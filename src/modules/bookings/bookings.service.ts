import crypto from "crypto";
import { AppError } from "../../middleware/error.middleware";
import { bookingsRepository, SALON_TIMEZONE } from "./bookings.repository";
import { clientsRepository } from "../clients/clients.repository";
import { generateUniqueReferralCode } from "../clients/clients.service";
import { notificationsService } from "../notifications/notifications.service";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { waScheduledMessagesService } from "../whatsapp-automation/wa-scheduled-messages.service";
import { appointmentsService } from "../appointments/appointments.service";
import { appointmentsRepository } from "../appointments/appointments.repository";
import { blockedTimesRepository } from "../blocked_times/blocked_times.repository";
import { hasFeature } from "../../middleware/planFeature.middleware";
import { PublicBookingRequest } from "./bookings.types";
import { bookingEmailOtpService } from "./booking-email-otp.service";
import logger from "../../config/logger";

// Attaches booking policy, brand kit, and the marketplace gallery — the
// hero band's background photo. A first pass at this (heavy cream wash over
// the whole image) looked washed-out/blurry rather than polished; this now
// only fetches what the page actually shows, and the page itself applies a
// left-side-only scrim instead of a full-image wash. Was also fetching
// marketplace working_hours/amenities and a full review summary (rating/
// review_count/rating_breakdown/reviews) on every public page load; an audit
// confirmed none of those are read in the frontend (the page's visible
// rating/review count come from a separate per-staff query), so those extra
// DB round trips on an unauthenticated, publicly-reachable endpoint stay
// removed.
async function attachPublicExtras(salon: any) {
    const [bookingPolicy, brandKit, gallery] = await Promise.all([
        bookingsRepository.findBookingPolicy(salon.id),
        bookingsRepository.findBrandKit(salon.id),
        salon?.marketplace_profile_id
            ? bookingsRepository.findGalleryImages(salon.marketplace_profile_id)
            : Promise.resolve([] as string[]),
    ]);
    return {
        ...salon,
        ...bookingPolicy,
        // null for every salon today (the brand-kit editor was removed), in
        // which case the booking page uses its own neutral palette.
        brand_kit: brandKit,
        gallery,
    };
}

// ── Availability ─────────────────────────────────────────────────────────────
// Real slot generation for the public booking page, replacing what used to be
// a pure hash-of-the-date fake list with no relation to actual bookings.

// Only used to step through a day when the salon hasn't chosen an interval —
// never to invent opening hours (see BUG-OB-016).
const DEFAULT_SLOT_INTERVAL_MINUTES = 15;

const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + (m || 0);
};

// An appointment's `scheduled_at` is an instant; staff schedules, marketplace
// working hours and blocked times are all local wall clock. Everything below
// compares the two, so every instant gets converted to the salon's local date
// and minutes-from-midnight here first. Doing this with getUTCHours() instead
// (what this used to do) silently shifted every time by the UTC offset.
function salonLocalParts(instant: string | Date): { dateStr: string; minutes: number } {
    const d = instant instanceof Date ? instant : new Date(instant);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: SALON_TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
        if (p.type !== "literal") acc[p.type] = p.value;
        return acc;
    }, {});
    // Some ICU builds render midnight as hour "24" under hour12:false.
    const hour = Number(parts.hour) % 24;
    return {
        dateStr: `${parts.year}-${parts.month}-${parts.day}`,
        minutes: hour * 60 + Number(parts.minute),
    };
}

// Whole days between two salon-local "YYYY-MM-DD" strings (negative if `to` is
// earlier). Parsed at UTC midnight purely as a calendar subtraction — no clock
// arithmetic, so DST and offsets can't skew it.
const dayDiff = (fromYMD: string, toYMD: string): number =>
    Math.round((Date.parse(`${toYMD}T00:00:00Z`) - Date.parse(`${fromYMD}T00:00:00Z`)) / 86_400_000);

type BookingPolicyInput = {
    min_notice_hours?: number | null;
    max_advance_days?: number | null;
    allow_same_day_booking?: boolean | null;
};

type DateWindow =
    | { bookable: false; reason: "PAST" | "SAME_DAY_OFF" | "TOO_FAR_AHEAD" }
    // Minutes from the requested date's local midnight; anything at or after
    // this is within policy. 0 means the whole day is open.
    | { bookable: true; earliestMinute: number };

// The one place a salon's booking window is decided — how soon is too soon,
// how far ahead is too far — so the offered slot list and the submit-time
// check can never drift apart. Everything here is calendar-day arithmetic in
// the salon's own timezone, never the server's.
function resolveDateWindow(dateStr: string, policy: BookingPolicyInput): DateWindow {
    const today = salonLocalParts(new Date());
    const daysOut = dayDiff(today.dateStr, dateStr);

    if (daysOut < 0) return { bookable: false, reason: "PAST" };
    if (daysOut === 0 && policy.allow_same_day_booking === false) {
        return { bookable: false, reason: "SAME_DAY_OFF" };
    }

    // Maximum advance booking, counted in whole days from today: a setting of
    // 30 on 5 Sep means 5 Oct is the last bookable date (daysOut === 30) and
    // 6 Oct is not. A missing/0 value means "not configured" rather than "today
    // only" — a zero here would otherwise lock every salon out of tomorrow the
    // moment the column exists but is unset.
    const maxAdvance = Number(policy.max_advance_days) || 0;
    if (maxAdvance > 0 && daysOut > maxAdvance) {
        return { bookable: false, reason: "TOO_FAR_AHEAD" };
    }

    // Minimum notice is measured from now, so on a later date this goes
    // negative and clamps to 0 (the whole day is open); on today it also rules
    // out slots that have already gone by, even when notice is zero.
    const noticeMinutes = Math.max(0, Number(policy.min_notice_hours) || 0) * 60;
    return { bookable: true, earliestMinute: Math.max(0, today.minutes + noticeMinutes - daysOut * 1440) };
}

// BUG-OB-012 / DECISION-OB-002: the admin Marketplace screens sit behind
// requirePlanFeature("online_booking"), but the public endpoints are
// unauthenticated and so never went through that middleware — a salon whose
// plan excludes online booking could still take bookings through its link,
// which made the paywall fiction. Same entitlement source as the middleware
// (hasFeature), just reached without a session.
const ONLINE_BOOKING_FEATURE = "online_booking";

async function assertSalonEntitled(salonId: string): Promise<void> {
    const entitled = await hasFeature(salonId, ONLINE_BOOKING_FEATURE);
    if (!entitled) {
        // Deliberately the same shape of message an unpublished salon gets —
        // a customer shouldn't be told about the salon's billing status.
        throw new AppError(
            404,
            "This salon isn't accepting online bookings right now. Please contact the salon directly.",
            "BOOKING_UNAVAILABLE"
        );
    }
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtHHMM = (totalMinutes: number): string =>
    `${pad2(Math.floor(totalMinutes / 60) % 24)}:${pad2(totalMinutes % 60)}`;

function fmt12h(totalMinutes: number): string {
    const h24 = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const ampm = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// A staff member's declared breaks for a date (Staff Schedule → Add Working
// Hours → breaks), stored as jsonb like [{"start_time":"13:00:00","end_time":
// "13:30:00"}]. These are unavailable time inside an otherwise-working day, so
// they have to come out of the offered slots the same way a booked appointment
// does — previously the column was written by the Web UI and read by nobody,
// which meant a stylist on a lunch break was still bookable through it.
type BreakRange = { start: number; end: number };

function parseBreaks(raw: unknown): BreakRange[] {
    let list: any = raw;
    if (typeof list === "string") {
        try { list = JSON.parse(list); } catch { return []; }
    }
    if (!Array.isArray(list)) return [];
    return list.reduce<BreakRange[]>((acc, b) => {
        const s = b?.start_time, e = b?.end_time;
        if (typeof s !== "string" || typeof e !== "string") return acc;
        const start = toMinutes(s.slice(0, 5));
        const end = toMinutes(e.slice(0, 5));
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) acc.push({ start, end });
        return acc;
    }, []);
}

const overlapsBreak = (breaks: BreakRange[], start: number, end: number): boolean =>
    breaks.some((b) => start < b.end && end > b.start);

// Shared by computeAvailableSlots (what the UI is offered) and createBooking's
// server-side re-check (what a submitted time is validated against) — both
// must agree on what "working that day" means, per staff, per date.
async function getStaffWindowsForDate(
    salonId: string,
    staffIds: string[],
    dateStr: string
): Promise<{ windowByStaff: Map<string, { open: number; close: number; breaks: BreakRange[] }>; stepMin: number }> {
    const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay();

    const [scheduleRows, marketplaceDayHours] = await Promise.all([
        bookingsRepository.findStaffScheduleForDate(staffIds, dateStr, dayOfWeek),
        bookingsRepository.findMarketplaceDayHours(salonId, dayOfWeek),
    ]);
    const scheduleByStaff = new Map(scheduleRows.map((r) => [r.staff_id as string, r]));

    // Resolution order per staff, per date (findStaffScheduleForDate already
    // picks the first of these two in SQL, date match winning):
    //   1. a row for this exact date          — a one-off override
    //   2. the recurring weekly row for this day_of_week (date IS NULL)
    //                                          — the staff member's baseline
    //   3. the salon's general working hours   — staff with no baseline at all
    //
    // Step 3 used to be withheld from anyone holding any schedule row at all,
    // on the reasoning that a configured staff member with no row for a date
    // isn't working that date. That only holds if a baseline exists to be
    // absent from — and nothing ever wrote one, so a stylist configured for a
    // single date went dark on every other date, i.e. touching Staff Schedule
    // made someone less bookable than ignoring it. A declared day off is an
    // is_available=false row, which is matched at step 1 or 2 and correctly
    // yields no window; "no row anywhere" now means unconfigured, not closed.
    //
    // BUG-OB-016: there is no hardcoded 9–6 any more. A salon that has
    // configured neither staff schedules nor marketplace working hours offers
    // NO slots, rather than inviting customers to book 9 AM on a day it may
    // well be shut. `marketplaceDayHours === null` (no row for this weekday)
    // and `is_open === false` (explicitly closed) both mean no fallback window.
    const salonOpen =
        marketplaceDayHours === null || marketplaceDayHours.is_open === false
            ? null
            : marketplaceDayHours;
    const stepMin = salonOpen?.slot_interval_minutes ?? DEFAULT_SLOT_INTERVAL_MINUTES;

    // The salon's day-wise Open/End Time from Settings is a hard ceiling: a
    // staff member's personal schedule can only narrow it, never exceed it.
    // If the salon is closed this day, nobody is bookable regardless of any
    // individual staff schedule row.
    const salonOpenMin = salonOpen ? toMinutes(salonOpen.open_time) : null;
    const salonCloseMin = salonOpen ? toMinutes(salonOpen.close_time) : null;

    // Each staff member's own [open, close) window in minutes-from-midnight
    // for this exact date, or absent if they're not working at all that day.
    const windowByStaff = new Map<string, { open: number; close: number; breaks: BreakRange[] }>();
    if (!salonOpen) return { windowByStaff, stepMin }; // salon closed this day — no one is bookable
    for (const id of staffIds) {
        const row = scheduleByStaff.get(id);
        if (row) {
            if (!row.is_available || !row.start_time || !row.end_time) continue; // explicit day off
            const open = Math.max(toMinutes(String(row.start_time).slice(0, 5)), salonOpenMin!);
            const close = Math.min(toMinutes(String(row.end_time).slice(0, 5)), salonCloseMin!);
            if (close <= open) continue; // staff's own hours don't overlap salon hours at all
            windowByStaff.set(id, { open, close, breaks: parseBreaks(row.breaks) });
        } else {
            // No exact-date row and no weekly baseline for this day — fall back
            // to the salon's general hours, which carry no per-staff breaks.
            windowByStaff.set(id, { open: salonOpenMin!, close: salonCloseMin!, breaks: [] });
        }
    }
    return { windowByStaff, stepMin };
}

async function computeAvailableSlots(params: {
    salonId: string;
    dateStr: string;
    staffId?: string;
    durationMinutes: number;
    // When no specific stylist is chosen, only staff who can perform these
    // services count towards "is anyone free" (BUG-OB-014).
    serviceIds?: string[] | null;
}): Promise<string[]> {
    const { salonId, dateStr, staffId, durationMinutes } = params;

    const [staffList, appointments, blockedTimes, policy] = await Promise.all([
        staffId ? Promise.resolve([{ id: staffId }]) : bookingsRepository.findActiveStaff(salonId, params.serviceIds),
        bookingsRepository.findAppointmentsForDate(salonId, dateStr),
        blockedTimesRepository.list({ salon_id: salonId, date: dateStr }),
        bookingsRepository.findBookingPolicy(salonId),
    ]);
    if (staffList.length === 0) return [];

    // Outside the salon's booking window (past, same-day off, or beyond the
    // maximum advance) — offer nothing rather than a list nobody can submit.
    const window = resolveDateWindow(dateStr, policy);
    if (!window.bookable) return [];
    const earliestMinute = window.earliestMinute;

    const staffIds = staffList.map((s) => s.id);
    const { windowByStaff, stepMin } = await getStaffWindowsForDate(salonId, staffIds, dateStr);
    if (windowByStaff.size === 0) return [];

    // Per-staff busy [start, end) ranges in minutes from salon-local midnight —
    // the same frame the schedule windows and blocked times below are in.
    // `start_minute` is converted from the appointment's instant in SQL
    // (findAppointmentsForDate), so an appointment at 1:00 PM local really does
    // occupy minute 780 here and removes the 1:00 PM slot.
    const busyByStaff = new Map<string, Array<{ start: number; end: number }>>();
    const addBusy = (id: string | null | undefined, start: number, end: number) => {
        if (!id) return;
        if (!busyByStaff.has(id)) busyByStaff.set(id, []);
        busyByStaff.get(id)!.push({ start, end });
    };
    for (const appt of appointments) {
        const start = Number(appt.start_minute);
        if (!Number.isFinite(start)) continue;
        addBusy(appt.staff_id, start, start + (Number(appt.duration_minutes) || 30));
    }
    for (const b of blockedTimes) {
        addBusy(b.staff_id, toMinutes(String(b.start_time).slice(0, 5)), toMinutes(String(b.end_time).slice(0, 5)));
    }

    const isStaffFreeAt = (id: string, start: number, end: number): boolean => {
        const win = windowByStaff.get(id);
        if (!win || start < win.open || end > win.close) return false;
        if (overlapsBreak(win.breaks, start, end)) return false;
        return !(busyByStaff.get(id) ?? []).some((r) => start < r.end && end > r.start);
    };

    const overallOpen  = Math.min(...Array.from(windowByStaff.values()).map((w) => w.open));
    const overallClose = Math.max(...Array.from(windowByStaff.values()).map((w) => w.close));

    const slots: string[] = [];
    for (let start = overallOpen; start + durationMinutes <= overallClose; start += stepMin) {
        if (start < earliestMinute) continue;
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

// Money for message templates. Uses the salon's own currency where it has one
// so an email doesn't quote rupees to a salon billing in dirhams.
function formatMoney(amount: number, currency?: string | null): string {
    const value = Number.isFinite(amount) ? amount : 0;
    try {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: (currency || "INR").toUpperCase(),
            maximumFractionDigits: 2,
        }).format(value);
    } catch {
        // Unknown/garbage currency code — never let formatting break a send.
        return value.toFixed(2);
    }
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
// Where the customer-facing booking pages live — same resolution the Link
// Builder uses, so a manage link in an email matches the one on the site.
const publicBaseUrl = () =>
    process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:5173";

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
        if (salon) await assertSalonEntitled(salon.id);
        if (!salon) {
            // "Salon not found" is wrong — and actively misleading — when the
            // link is correct and the salon has simply turned online booking
            // off. That reads as a broken URL and sends people hunting for a
            // typo instead of phoning the salon.
            const state = await bookingsRepository.findSalonStateBySlug(slug);
            if (state) {
                throw new AppError(
                    404,
                    "This salon isn't accepting online bookings right now. Please contact the salon directly.",
                    "BOOKING_UNAVAILABLE"
                );
            }
            throw new AppError(404, "Salon not found", "NOT_FOUND");
        }

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

    async getAvailability(params: {
        salon_id: string; date: string; staffId?: string;
        durationMinutes?: number; serviceIds?: string[] | null;
    }) {
        const salon = await bookingsRepository.findSalonById(params.salon_id);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        await assertSalonEntitled(params.salon_id);
        const slots = await computeAvailableSlots({
            salonId: params.salon_id,
            dateStr: params.date,
            staffId: params.staffId,
            durationMinutes: Math.max(15, Number(params.durationMinutes) || 30),
            serviceIds: params.serviceIds ?? null,
        });
        return { slots };
    },

    async createBooking(body: PublicBookingRequest) {
        // Cheapest check first: reject before touching the DB at all if the
        // client's email hasn't been through POST /bookings/email-otp/verify.
        // validateCreateBooking already rejected a missing/malformed address;
        // this is the actual proof of ownership.
        const emailVerified = await bookingEmailOtpService.isVerified(body.client_email);
        if (!emailVerified) {
            throw new AppError(403, "Please verify your email before booking.", "EMAIL_NOT_VERIFIED");
        }

        // findSalonById already excludes inactive/unpublished salons — reject
        // up front instead of letting an unpublished salon still take bookings
        // via a direct link (the marketplace Unpublish toggle must actually work).
        const salon = await bookingsRepository.findSalonById(body.salon_id);
        if (!salon) throw new AppError(404, "This salon is not accepting online bookings", "NOT_FOUND");
        await assertSalonEntitled(body.salon_id);

        // Same-day switch / minimum notice / past-date, checked before anything
        // is written. The offered slot list already excludes these, but a tab
        // left open across midnight or a direct API call would sail past it.
        const requested = salonLocalParts(body.scheduled_at);
        const policy = await bookingsRepository.findBookingPolicy(body.salon_id);
        const window = resolveDateWindow(requested.dateStr, policy);
        if (!window.bookable) {
            const days = Number(policy.max_advance_days) || 0;
            const message =
                window.reason === "SAME_DAY_OFF"
                    ? "This salon isn't accepting bookings for today. Please choose a later date."
                : window.reason === "TOO_FAR_AHEAD"
                    ? `This salon takes bookings up to ${days} day${days === 1 ? "" : "s"} ahead. Please choose an earlier date.`
                    : "That date has already passed. Please choose another date.";
            throw new AppError(409, message, window.reason === "TOO_FAR_AHEAD" ? "TOO_FAR_AHEAD" : "DATE_NOT_BOOKABLE");
        }
        const earliestMinute = window.earliestMinute;
        if (requested.minutes < earliestMinute) {
            const hrs = Math.max(0, Number(policy.min_notice_hours) || 0);
            throw new AppError(
                409,
                hrs > 0
                    ? `This salon needs at least ${hrs} hour${hrs === 1 ? "" : "s"} notice. Please choose a later time.`
                    : "That time has already passed. Please choose a later time.",
                "TOO_SOON"
            );
        }

        const services = await Promise.all(
            body.service_ids.map((id) => bookingsRepository.findServiceById(id, body.salon_id))
        );
        if (services.some((s) => !s)) {
            throw new AppError(404, "Service not found for this salon", "NOT_FOUND");
        }

        const durationMinutes = services.reduce((sum, s) => sum + (Number(s!.duration) || 30), 0);

        // Salon-local date and wall clock (resolved above) — blocked times and
        // staff schedules are stored as local TIME values, so the requested
        // instant has to be expressed in the same frame to be comparable.
        const { dateStr, minutes: startMin } = requested;
        const endMin = startMin + durationMinutes;

        // Which stylists could take this booking at all: active, allowed to take
        // calendar bookings, and able to perform every selected service
        // (BUG-OB-013 / BUG-OB-014).
        const eligible = await bookingsRepository.findActiveStaff(body.salon_id, body.service_ids);
        if (eligible.length === 0) {
            throw new AppError(409, "No stylist at this salon can perform the selected services online.", "NO_ELIGIBLE_STAFF");
        }

        if (body.staff_id && !eligible.some((s: any) => s.id === body.staff_id)) {
            // Either the stylist isn't at this salon, isn't bookable online, or
            // doesn't perform one of these services. All the same to the
            // customer, and none of them worth leaking individually.
            throw new AppError(409, "That stylist isn't available for the selected services.", "STAFF_NOT_ELIGIBLE");
        }

        // BUG-OB-002 + BUG-OB-003: serialise concurrent attempts for this salon
        // and date, then choose/verify the stylist inside that lock. Two requests
        // could otherwise both pass the overlap check before either inserts — a
        // read-then-write can't close that window and there's no exclusion
        // constraint underneath.
        const assignment = await bookingsRepository.withBookingLock(
            body.salon_id,
            dateStr,
            async (dbClient) => {
                const candidates: string[] = body.staff_id
                    ? [body.staff_id]
                    : eligible.map((s: any) => String(s.id));

                const { windowByStaff } = await getStaffWindowsForDate(body.salon_id, candidates, dateStr);
                let lastReason: { message: string; code: string } | null = null;

                for (const staffId of candidates) {
                    const win = windowByStaff.get(staffId);
                    if (!win || startMin < win.open || endMin > win.close) {
                        lastReason = { message: "This stylist isn't working at the selected time.", code: "OUTSIDE_WORKING_HOURS" };
                        continue;
                    }
                    if (overlapsBreak(win.breaks, startMin, endMin)) {
                        lastReason = { message: "This stylist is on a break at the selected time.", code: "STAFF_ON_BREAK" };
                        continue;
                    }

                    const blocked = await blockedTimesRepository.hasOverlap({
                        staffId,
                        date: dateStr,
                        startTime: fmtHHMM(startMin),
                        endTime: fmtHHMM(endMin),
                    });
                    if (blocked) {
                        lastReason = { message: "This time is no longer available for the selected stylist.", code: "BLOCKED_TIME" };
                        continue;
                    }

                    const taken = await bookingsRepository.hasAppointmentOverlap(
                        { salonId: body.salon_id, staffId, dateStr, startMinute: startMin, endMinute: endMin },
                        dbClient
                    );
                    if (taken) {
                        lastReason = { message: "This time has just been booked. Please pick another slot.", code: "SLOT_TAKEN" };
                        continue;
                    }

                    return { staffId, lastReason: null as { message: string; code: string } | null };
                }

                return { staffId: null as string | null, lastReason };
            }
        );

        if (!assignment.staffId) {
            const reason = assignment.lastReason ?? {
                message: "This time is no longer available. Please pick another slot.",
                code: "SLOT_TAKEN",
            };
            throw new AppError(409, reason.message, reason.code);
        }

        // Every booking created here now carries a real stylist — "Any Stylist"
        // no longer leaves an unassigned row for someone to notice later.
        const assignedStaffId: string = assignment.staffId;
        // Preserved separately from assignedStaffId so the Calendar can still
        // show this in its own "Any" column — the customer's actual
        // preference (or lack of one) would otherwise be lost the moment a
        // real stylist gets picked for them.
        const isAnyStaff = !body.staff_id;

        // Find or create the client for this salon. Phone is the unique
        // identifier here, not email: findExistingByEmailOrPhone (used
        // elsewhere) checks email FIRST, which would silently attach this
        // booking to an unrelated client that merely shares an email (a
        // family/shared address) while never even looking at the phone number
        // typed on this exact form. A phone number is entered fresh on every
        // booking and, unlike email, may contain spaces/dashes the user typed
        // — normalise to digits before matching or storing so "9876543210"
        // and "987-654-3210" are recognised as the same client.
        const phoneDigits = String(body.client_phone || "").replace(/\D/g, "");
        let client = await clientsRepository.findActiveByPhone(phoneDigits, body.salon_id);

        if (!client) {
            const nameParts = body.client_name.trim().split(/\s+/);
            const referralCode = await generateUniqueReferralCode(nameParts[0], body.salon_id);
            client = await clientsRepository.create(
                {
                    first_name: nameParts[0],
                    last_name: nameParts.slice(1).join(" ") || null,
                    email: body.client_email || null,
                    phone_number: phoneDigits,
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

        // durationMinutes is computed once above, before the availability checks.
        const title = services.map((s) => s!.name).join(", ");

        const appointment = await bookingsRepository.createAppointment({
            salonId: body.salon_id,
            clientId: client.id,
            staffId: assignedStaffId,
            isAnyStaff,
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
                staff_id: assignedStaffId,
            })),
        });

        // Live calendar update — the dashboard calendar refreshes on this same
        // socket event used for staff-created appointments (appointments.service.ts).
        // `event_key` makes this obey the owner's own notification preferences,
        // the way every staff-created appointment already does; without it this
        // one push ignored a preference the owner had explicitly set.
        notificationsService.create({
            salon_id: body.salon_id,
            type: "appointment",
            title: "New Appointment Booked",
            body: `${body.client_name} — ${formatDate(body.scheduled_at)} at ${formatTime(body.scheduled_at)}`,
            event_key: "newAppointment",
            scheduled_at: body.scheduled_at,
        }).catch((err: any) => {
            logger.error("Public booking notification failed", {
                appointmentId: appointment.id,
                salonId: body.salon_id,
                message: err?.message,
                stack: err?.stack,
                error: err,
            });
        });

        // ── Client-facing WhatsApp ────────────────────────────────────────────
        // A booking made here writes the appointment row directly rather than
        // going through appointmentsService.create(), so it never reached any of
        // that path's client messaging — an online customer got a confirmation
        // screen and nothing else. These are the same two sends a staff-created
        // calendar appointment fires, using the same events, templates and
        // dedupe guard, so the two paths now behave identically.
        //
        // Everything that decides whether a message actually goes out lives
        // inside trigger(): the salon's per-event enable switch, the client's
        // notification opt-out, an approved template, the salon's own WhatsApp
        // credentials, phone validation, delivery logging and retry. Nothing is
        // re-implemented here, and a failure never affects the booking.
        void (async () => {
            try {
                const full = await appointmentsRepository.findById(appointment.id);
                const clientPhone = (full as any)?.client_phone;
                if (!full || !clientPhone) return;

                // Richer detail for the Email/SMS templates. These travel in
                // extraVariables rather than `variables` because a Meta
                // template is approved with a fixed parameter count — adding
                // them to `variables` would break the WhatsApp send for every
                // salon whose template is already approved with six.
                const totalAmount = services.reduce((sum, s) => sum + (Number(s!.price) || 0), 0);
                // Public booking takes no payment, so nothing is collected up
                // front and the whole amount is still due at the salon. Written
                // out rather than assumed, so it stays correct if a deposit
                // step is ever added here.
                const paidAmount = 0;
                const address = (salon as any).address ?? "";
                const cancellationHours = Number(policy.cancellation_notice_hours) || 0;
                const manageUrl = (salon as any).slug
                    ? `${publicBaseUrl()}/book/${(salon as any).slug}/manage/${appointment.id}?token=${generateManageToken(appointment.id)}`
                    : "";
                // An "Any Available" booking's real staff_name is only the
                // auto-assignment's pick, not a confirmed stylist — naming
                // them here would tell the customer someone specific before
                // the salon has actually reviewed/assigned it (see the
                // Calendar's "Any" column, which requires exactly that review
                // before is_any_staff clears). Every downstream message
                // (WhatsApp confirmation, its 24h reminder, and the email
                // template's {{staff_name}} token, which is fed from this
                // same "6" positional variable) uses this instead.
                const staffNameForMessages = isAnyStaff
                    ? "our team"
                    : (full.staff_name ?? "our team");

                const extraVariables: Record<string, string> = {
                    booking_id:        appointment.id,
                    appointment_id:    appointment.id,
                    appointment_amount: formatMoney(totalAmount, (salon as any).currency),
                    paid_amount:       formatMoney(paidAmount, (salon as any).currency),
                    deposit_amount:    formatMoney(paidAmount, (salon as any).currency),
                    remaining_amount:  formatMoney(totalAmount - paidAmount, (salon as any).currency),
                    salon_address:     address,
                    google_maps_link:  address
                        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
                        : "",
                    cancellation_policy: cancellationHours > 0
                        ? `Free cancellation up to ${cancellationHours} hour${cancellationHours === 1 ? "" : "s"} before your appointment.`
                        : "You can cancel or reschedule any time before your appointment.",
                    manage_booking_link: manageUrl,
                };

                whatsappAutomationService.trigger({
                    salonId:       full.salon_id,
                    eventType:     "appointment_confirmation",
                    clientId:      full.client_id,
                    phone:         clientPhone,
                    countryCode:   (full as any).client_phone_code ?? null,
                    email:         (full as any).client_email ?? body.client_email ?? null,
                    extraVariables,
                    variables: {
                        "1": full.client_name                 ?? "Valued Customer",
                        "2": (full as any).salon_name         ?? "our salon",
                        "3": formatDate(full.scheduled_at),
                        "4": formatTime(full.scheduled_at),
                        "5": full.services?.[0]?.name ?? full.title ?? "your service",
                        "6": staffNameForMessages,
                    },
                    // Keyed on the appointment, so a retried submit or a double
                    // click can never produce a second confirmation.
                    referenceId:       full.id,
                    referenceType:     "appointment",
                    dedupeByReference: true,
                }).catch(() => {});

                // 24h reminder. Package-linked bookings get their own reminder
                // event elsewhere and would otherwise be messaged twice — public
                // booking can't create one today, but mirror the guard so this
                // doesn't silently become wrong if it ever can.
                const isPackageLinked = (full.services ?? []).some((s: any) => s.is_package_service);
                if (!isPackageLinked) {
                    waScheduledMessagesService.scheduleAppointmentReminder({
                        salonId:       full.salon_id,
                        clientId:      full.client_id,
                        phone:         clientPhone,
                        countryCode:   (full as any).client_phone_code ?? null,
                        appointmentId: full.id,
                        scheduledAt:   full.scheduled_at,
                        clientName:    full.client_name         ?? "Valued Customer",
                        salonName:     (full as any).salon_name ?? "our salon",
                        serviceName:   full.services?.[0]?.name ?? full.title ?? "your service",
                        staffName:     staffNameForMessages,
                    }).catch((err: any) =>
                        logger.error("[wa-scheduled] public booking reminder schedule failed:", err?.message ?? err)
                    );
                }
            } catch (err: any) {
                // Never affects the booking the customer just made — but log it,
                // so a real fault here doesn't disappear.
                logger.error("[WA-AUTO] public booking client messaging failed", {
                    appointmentId: appointment.id,
                    salonId: body.salon_id,
                    message: err?.message,
                });
            }
        })();

        return { ...appointment, manage_token: generateManageToken(appointment.id) };
    },

    // ── Client self-service: manage a booking via its signed link ─────────────

    async getManagedAppointment(appointmentId: string, token: string | undefined | null) {
        assertManageToken(appointmentId, token);
        const appointment = await appointmentsRepository.findById(appointmentId);
        if (!appointment) throw new AppError(404, "Booking not found", "NOT_FOUND");
        return appointment;
    },

    async cancelManagedAppointment(appointmentId: string, token: string | undefined | null, reason?: string | null) {
        assertManageToken(appointmentId, token);

        // BUG-OB-007: the cancellation notice period was shown to the customer
        // on the booking page as a promise and then enforced nowhere — cancel
        // went through no matter how close to the appointment it was. The
        // public policy text and the actual behaviour now agree.
        const appointment = await appointmentsRepository.findById(appointmentId);
        if (!appointment) throw new AppError(404, "Booking not found", "NOT_FOUND");

        const policy = await bookingsRepository.findBookingPolicy(appointment.salon_id);
        const noticeHours = Math.max(0, Number(policy.cancellation_notice_hours) || 0);
        if (noticeHours > 0) {
            const startsAt = new Date(appointment.scheduled_at).getTime();
            const cutoff = startsAt - noticeHours * 60 * 60 * 1000;
            if (Date.now() > cutoff) {
                throw new AppError(
                    409,
                    `This salon asks for at least ${noticeHours} hour${noticeHours === 1 ? "" : "s"} notice to cancel online. Please contact the salon directly.`,
                    "CANCELLATION_TOO_LATE"
                );
            }
        }

        // The reason the customer picked is stored against the appointment, so
        // the salon can see why a slot freed up rather than only that it did.
        return appointmentsService.cancel({
            appointmentId,
            requesterUserId: "public-client",
            body: { reason: reason?.trim() || undefined },
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
