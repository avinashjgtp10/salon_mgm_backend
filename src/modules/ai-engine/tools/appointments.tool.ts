import { appointmentsService } from "../../appointments/appointments.service";
import { appointmentsRepository } from "../../appointments/appointments.repository";
import { servicesService } from "../../services/services.service";
import { salonsRepository } from "../../salons/salons.repository";
import { AppError } from "../../../middleware/error.middleware";
import { AgentContext, Tool } from "../ai-engine.types";
import { requireUuid, requireFutureDateTime } from "./id-validation";

const IST_OFFSET = "+05:30";

function toScheduledAtIso(date: string, hhmm: string): string {
    return new Date(`${date}T${hhmm}:00${IST_OFFSET}`).toISOString();
}

async function requireOwnedAppointment(appointmentIdRaw: string, ctx: AgentContext) {
    const appointmentId = requireUuid(appointmentIdRaw, "appointment_id", "checkAppointmentStatus");
    const existing = await appointmentsRepository.findById(appointmentId);
    if (!existing || existing.salon_id !== ctx.salonId || existing.client_id !== ctx.clientId) {
        throw new AppError(404, "Appointment not found", "NOT_FOUND");
    }
    return existing;
}

export const createAppointmentTool: Tool = {
    name: "createAppointment",
    description:
        "Book an appointment for one or more services with the SAME staff member, back-to-back in a single slot. Only call this AFTER the customer has explicitly confirmed every service, the staff member, date, and time (from checkAvailability, checked for the COMBINED duration of all services together). Price and duration are pulled from the real service records, never from your own estimate. If the customer wants to add a service to an appointment you already booked in this conversation, do NOT call this again for just the new service — that creates a second, separate, likely conflicting appointment. Instead cancel the existing one (cancelAppointment) and re-book everything together with this tool in one call. If the customer wants DIFFERENT services with DIFFERENT staff members (e.g. a haircut with one stylist and a facial with another), call this tool once per staff member instead — each staff member is booked separately since they're independent resources and can't conflict with each other.",
    parameters: {
        type: "object",
        properties: {
            service_ids: {
                type: "array",
                items: { type: "string" },
                description: "One or more real service ids from getServices — every service the customer wants in this appointment.",
            },
            staff_id: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            time: { type: "string", description: "HH:MM (24h) — start time for the first service; must be a slot returned by checkAvailability for the combined duration of all services" },
            notes: { type: "string", description: "Any special request the customer mentioned" },
        },
        required: ["service_ids", "staff_id", "date", "time"],
    },
    async execute(args, ctx: AgentContext) {
        const serviceIdsRaw: unknown[] = Array.isArray(args.service_ids) ? args.service_ids : [args.service_ids];
        if (serviceIdsRaw.length === 0) throw new AppError(400, "At least one service_id is required.", "BAD_REQUEST");
        const serviceIds = serviceIdsRaw.map((id) => requireUuid(id, "service_id", "getServices"));
        const staffId = requireUuid(args.staff_id, "staff_id", "getStaff");

        const services = await Promise.all(serviceIds.map((id) => servicesService.getById(id, ctx.salonId)));
        const salon = await salonsRepository.findById(ctx.salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const scheduledAt = toScheduledAtIso(args.date, args.time);
        requireFutureDateTime(scheduledAt);

        const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);
        const totalPrice = services.reduce((sum, s) => sum + Number(s.price), 0);

        const appointment = await appointmentsService.create({
            requesterUserId: salon.owner_id,
            body: {
                salon_id: ctx.salonId,
                client_id: ctx.clientId ?? undefined,
                staff_id: staffId,
                service_id: services[0].id,
                scheduled_at: scheduledAt,
                duration_minutes: totalDuration,
                notes: `Booked via LUNOX AI Receptionist (WhatsApp).${args.notes ? " Note: " + args.notes : ""}`,
                services: services.map((service) => ({
                    service_id: service.id,
                    staff_id: staffId,
                    name: service.name,
                    price: Number(service.price),
                    quantity: 1,
                })),
            },
        });

        return {
            booked: true,
            appointment_id: appointment.id,
            services: services.map((s) => s.name),
            total_price: totalPrice,
            total_duration_minutes: totalDuration,
            scheduled_at: appointment.scheduled_at,
            status: appointment.status,
        };
    },
};

export const cancelAppointmentTool: Tool = {
    name: "cancelAppointment",
    description: "Cancel one of this customer's own upcoming appointments. Confirm with the customer before calling this.",
    parameters: {
        type: "object",
        properties: {
            appointment_id: { type: "string" },
            reason: { type: "string" },
        },
        required: ["appointment_id"],
    },
    async execute(args, ctx: AgentContext) {
        await requireOwnedAppointment(args.appointment_id, ctx);
        const cancelled = await appointmentsService.cancel({
            appointmentId: args.appointment_id,
            requesterUserId: ctx.clientId ?? "whatsapp-customer",
            body: { reason: args.reason },
        });
        return { cancelled: true, appointment_id: cancelled.id, status: cancelled.status };
    },
};

export const rescheduleAppointmentTool: Tool = {
    name: "rescheduleAppointment",
    description:
        "Move one of this customer's own upcoming appointments to a new date/time, and optionally a new staff member too. Always call checkAvailability for the new slot (with the new staff_id, if changing staff) first, and confirm with the customer before calling this.",
    parameters: {
        type: "object",
        properties: {
            appointment_id: { type: "string" },
            date: { type: "string", description: "New date, YYYY-MM-DD" },
            time: { type: "string", description: "New time, HH:MM (24h)" },
            staff_id: { type: "string", description: "Optional — pass this only if the customer also wants to change the staff member, a real id from getStaff" },
        },
        required: ["appointment_id", "date", "time"],
    },
    async execute(args, ctx: AgentContext) {
        await requireOwnedAppointment(args.appointment_id, ctx);
        const scheduledAt = toScheduledAtIso(args.date, args.time);
        requireFutureDateTime(scheduledAt);
        const staffId = args.staff_id ? requireUuid(args.staff_id, "staff_id", "getStaff") : undefined;
        const updated = await appointmentsService.update({
            appointmentId: args.appointment_id,
            requesterUserId: ctx.clientId ?? "whatsapp-customer",
            patch: { scheduled_at: scheduledAt, ...(staffId ? { staff_id: staffId } : {}) },
        });
        return { rescheduled: true, appointment_id: updated.id, scheduled_at: updated.scheduled_at, staff_id: updated.staff_id };
    },
};

export const modifyAppointmentServicesTool: Tool = {
    name: "modifyAppointmentServices",
    description:
        "Add and/or remove services on one of this customer's own existing appointments — booked earlier, or one you already booked in this conversation. The staff member and time stay the same, only what's booked changes. Price adjusts automatically to match the new service list — you never process a refund or payment yourself, staff collects the actual payment at checkout. If removing services would leave nothing booked at all (no services, packages, products, or memberships left), this cancels the appointment instead — tell the customer that plainly, don't let it happen silently. Always call checkAppointmentStatus first to get the real service_ids currently on the appointment before removing any.",
    parameters: {
        type: "object",
        properties: {
            appointment_id: { type: "string" },
            add_service_ids: { type: "array", items: { type: "string" }, description: "Real service ids from getServices to add" },
            remove_service_ids: { type: "array", items: { type: "string" }, description: "Real service ids, from checkAppointmentStatus, currently on this appointment to remove" },
        },
        required: ["appointment_id"],
    },
    async execute(args, ctx: AgentContext) {
        const existing = await requireOwnedAppointment(args.appointment_id, ctx);

        const addIds = Array.isArray(args.add_service_ids)
            ? args.add_service_ids.map((id: unknown) => requireUuid(id, "service_id", "getServices"))
            : [];
        const removeIds = Array.isArray(args.remove_service_ids)
            ? args.remove_service_ids.map((id: unknown) => requireUuid(id, "service_id", "checkAppointmentStatus"))
            : [];
        if (addIds.length === 0 && removeIds.length === 0) {
            throw new AppError(400, "Provide at least one service to add or remove.", "BAD_REQUEST");
        }

        const remainingExisting = (existing.services ?? []).filter((s) => !removeIds.includes(s.service_id));
        const finalServiceIds = [...remainingExisting.map((s) => s.service_id), ...addIds];

        const hasOtherItems =
            (existing.package_items?.length ?? 0) > 0 ||
            (existing.product_items?.length ?? 0) > 0 ||
            (existing.membership_items?.length ?? 0) > 0;

        if (finalServiceIds.length === 0 && !hasOtherItems) {
            const cancelled = await appointmentsService.cancel({
                appointmentId: existing.id,
                requesterUserId: ctx.clientId ?? "whatsapp-customer",
                body: { reason: "Customer removed all booked services via LUNOX" },
            });
            return {
                cancelled: true,
                appointment_id: cancelled.id,
                status: cancelled.status,
                reason: "No services remained after removal",
            };
        }

        // Re-fetch every final service fresh — never trust a stale stored
        // price/duration, same rule createAppointment already follows.
        const finalServices = await Promise.all(finalServiceIds.map((id) => servicesService.getById(id, ctx.salonId)));
        const totalDuration = finalServices.reduce((sum, s) => sum + s.duration, 0);
        const totalPrice = finalServices.reduce((sum, s) => sum + Number(s.price), 0);

        const updated = await appointmentsService.update({
            appointmentId: existing.id,
            requesterUserId: ctx.clientId ?? "whatsapp-customer",
            patch: {
                duration_minutes: totalDuration,
                services: finalServices.map((service) => ({
                    service_id: service.id,
                    staff_id: existing.staff_id ?? undefined,
                    name: service.name,
                    price: Number(service.price),
                    quantity: 1,
                })),
            },
        });

        return {
            updated: true,
            appointment_id: updated.id,
            services: finalServices.map((s) => s.name),
            total_price: totalPrice,
            total_duration_minutes: totalDuration,
            scheduled_at: updated.scheduled_at,
        };
    },
};

export const checkAppointmentStatusTool: Tool = {
    name: "checkAppointmentStatus",
    description:
        "Check the status of this customer's appointment(s). Pass appointment_id to look up one specific appointment, or omit it to list all of the customer's upcoming (not-yet-completed) appointments.",
    parameters: {
        type: "object",
        properties: {
            appointment_id: { type: "string", description: "Optional — omit to list all upcoming appointments instead" },
        },
    },
    async execute(args, ctx: AgentContext) {
        if (args.appointment_id) {
            const appt = await requireOwnedAppointment(args.appointment_id, ctx);
            return {
                appointment_id: appt.id,
                status: appt.status,
                scheduled_at: appt.scheduled_at,
                // service_id included (not just name) so modifyAppointmentServices
                // can be called with real ids — never re-derive an id by fuzzy
                // name-matching a booked service.
                services: appt.services?.map((s) => ({ service_id: s.service_id, name: s.name, price: s.price })) ?? [],
                staff_id: appt.staff_id,
                payment_status: appt.payment_status,
            };
        }

        if (!ctx.clientId) return { appointments: [] };
        const all = await appointmentsRepository.listByClientId(ctx.clientId);
        const now = Date.now();
        const upcoming = all
            .filter((a) => !["completed", "cancelled", "no_show"].includes(a.status) && new Date(a.scheduled_at).getTime() >= now)
            .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

        return {
            appointments: upcoming.map((a) => ({
                appointment_id: a.id,
                status: a.status,
                scheduled_at: a.scheduled_at,
                services: a.services?.map((s) => ({ service_id: s.service_id, name: s.name, price: s.price })) ?? [],
                staff_id: a.staff_id,
                payment_status: a.payment_status,
            })),
        };
    },
};

export const addAppointmentNoteTool: Tool = {
    name: "addAppointmentNote",
    description:
        "Add a note to one of this customer's own upcoming appointments (e.g. a special request they mention after booking). Appends to any existing notes — never overwrites them.",
    parameters: {
        type: "object",
        properties: {
            appointment_id: { type: "string" },
            note: { type: "string", description: "The note to add" },
        },
        required: ["appointment_id", "note"],
    },
    async execute(args, ctx: AgentContext) {
        const existing = await requireOwnedAppointment(args.appointment_id, ctx);
        const combinedNotes = [existing.notes, `[LUNOX] ${args.note}`].filter(Boolean).join("\n");
        const updated = await appointmentsService.update({
            appointmentId: args.appointment_id,
            requesterUserId: ctx.clientId ?? "whatsapp-customer",
            patch: { notes: combinedNotes },
        });
        return { noted: true, appointment_id: updated.id };
    },
};
