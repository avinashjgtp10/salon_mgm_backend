import { appointmentsRepository } from "../../appointments/appointments.repository";
import { blockedTimesRepository } from "../../blocked_times/blocked_times.repository";
import { staffService } from "../../staff/staff.service";
import { branchesRepository } from "../../branches/branches.repository";
import { AgentContext, Tool } from "../ai-engine.types";
import { requireUuid } from "./id-validation";

const SLOT_STEP_MINUTES = 30;
// High enough to cover a full business day (e.g. 10:00-22:00 at 30-min steps = 24)
// without silently cutting off the afternoon/evening like the old cap of 8 did.
const MAX_SLOTS_RETURNED = 32;
const IST_OFFSET = "+05:30";
const DEFAULT_OPEN = "10:00";
const DEFAULT_CLOSE = "20:00";

function toScheduledAtIso(date: string, hhmm: string): string {
    return new Date(`${date}T${hhmm}:00${IST_OFFSET}`).toISOString();
}

function addMinutes(hhmm: string, minutes: number): string {
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + minutes;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
}

function isBefore(a: string, b: string): boolean {
    return a < b; // "HH:MM" strings compare lexicographically
}

function toHHMM(time: string): string {
    return time.slice(0, 5); // "10:30:00" -> "10:30"
}

// This salon doesn't use per-staff shift schedules — every active staff member
// is assumed available during the salon's own opening hours for the day.
async function getSalonHoursForDate(salonId: string, date: string): Promise<{ open: string; close: string } | null> {
    const branches = await branchesRepository.listBySalonId(salonId);
    const branch = branches.find((b) => b.is_main) ?? branches[0] ?? null;
    if (!branch) return { open: DEFAULT_OPEN, close: DEFAULT_CLOSE };

    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    const timings = await branchesRepository.listTimings(branch.id);
    const today = timings.find((t) => t.day_of_week === dayOfWeek);

    if (today) {
        if (today.is_closed) return null;
        return { open: toHHMM(today.opening_time), close: toHHMM(today.closing_time) };
    }

    if (branch.opening_time && branch.closing_time) {
        return { open: toHHMM(branch.opening_time), close: toHHMM(branch.closing_time) };
    }

    return { open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
}

async function findSlotsForStaff(
    staffId: string,
    date: string,
    durationMinutes: number,
    hours: { open: string; close: string }
): Promise<string[]> {
    const latestStart = addMinutes(hours.close, -durationMinutes);
    const slots: string[] = [];

    let cursor = hours.open;
    while (isBefore(cursor, latestStart) || cursor === latestStart) {
        if (slots.length >= MAX_SLOTS_RETURNED) break;

        const scheduledAt = toScheduledAtIso(date, cursor);
        // For "today" queries, don't offer a slot that's already elapsed.
        if (new Date(scheduledAt).getTime() <= Date.now()) {
            cursor = addMinutes(cursor, SLOT_STEP_MINUTES);
            continue;
        }

        const [conflict, blocked] = await Promise.all([
            appointmentsRepository.hasConflict({ staffId, scheduledAt, durationMinutes }),
            blockedTimesRepository.hasOverlap({
                staffId,
                date,
                startTime: cursor,
                endTime: addMinutes(cursor, durationMinutes),
            }),
        ]);

        if (!conflict && !blocked) slots.push(cursor);
        cursor = addMinutes(cursor, SLOT_STEP_MINUTES);
    }

    return slots;
}

export const checkAvailabilityTool: Tool = {
    name: "checkAvailability",
    description:
        "Check a specific staff member's availability on a date. Pass 'time' to directly check one exact slot the customer asked for (e.g. they said '5pm') — this is the precise, authoritative check, always use it when a specific time is on the table. Omit 'time' to instead get a list of open slots for that day.",
    parameters: {
        type: "object",
        properties: {
            staff_id: { type: "string", description: "The staff member's id, from getStaff" },
            date: { type: "string", description: "Date in YYYY-MM-DD format" },
            duration_minutes: { type: "number", description: "Service duration in minutes (from getServices)" },
            time: { type: "string", description: "Optional exact time HH:MM (24h) to check directly, e.g. '17:00' for 5pm" },
        },
        required: ["staff_id", "date", "duration_minutes"],
    },
    async execute(args, ctx: AgentContext) {
        const staffId = requireUuid(args.staff_id, "staff_id", "getStaff");
        const duration = Number(args.duration_minutes) || 30;
        const hours = await getSalonHoursForDate(ctx.salonId, args.date);
        if (!hours) return { staff_id: staffId, date: args.date, available: false, slots: [], reason: "closed" };

        if (args.time) {
            const time = String(args.time);
            const latestStart = addMinutes(hours.close, -duration);
            if (isBefore(time, hours.open) || isBefore(latestStart, time)) {
                return { staff_id: staffId, date: args.date, time, available: false, reason: "outside business hours" };
            }
            const scheduledAt = toScheduledAtIso(args.date, time);
            if (new Date(scheduledAt).getTime() <= Date.now()) {
                return { staff_id: staffId, date: args.date, time, available: false, reason: "already passed" };
            }
            const [conflict, blocked] = await Promise.all([
                appointmentsRepository.hasConflict({ staffId, scheduledAt, durationMinutes: duration }),
                blockedTimesRepository.hasOverlap({
                    staffId,
                    date: args.date,
                    startTime: time,
                    endTime: addMinutes(time, duration),
                }),
            ]);
            return { staff_id: staffId, date: args.date, time, available: !conflict && !blocked };
        }

        const slots = await findSlotsForStaff(staffId, args.date, duration, hours);
        return {
            staff_id: staffId,
            date: args.date,
            available: slots.length > 0,
            slots,
        };
    },
};

export const suggestAvailableStaffTool: Tool = {
    name: "suggestAvailableStaff",
    description:
        "Find which staff members have an open slot on a given date. Every active staff member can perform every service at this salon, so service_id doesn't restrict candidates — it's accepted for context only. Use this when the customer doesn't already have a preferred stylist and asks something like 'who's free Tuesday?' or 'who can do a haircut tomorrow?'.",
    parameters: {
        type: "object",
        properties: {
            date: { type: "string", description: "Date in YYYY-MM-DD format" },
            duration_minutes: { type: "number", description: "Service duration in minutes (from getServices)" },
            service_id: { type: "string", description: "Optional, for context only — every staff member can perform every service" },
        },
        required: ["date", "duration_minutes"],
    },
    async execute(args, ctx: AgentContext) {
        const duration = Number(args.duration_minutes) || 30;

        const hours = await getSalonHoursForDate(ctx.salonId, args.date);
        if (!hours) return { date: args.date, staff: [], closed: true };

        const staffList = await staffService.list(ctx.salonId, { is_active: true, limit: 100 } as any);
        const candidates: any[] = staffList.data;

        const results = await Promise.all(
            candidates.map(async (s) => {
                const slots = await findSlotsForStaff(s.id, args.date, duration, hours);
                return slots.length > 0
                    ? {
                          staff_id: s.id,
                          name: [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email,
                          slots,
                      }
                    : null;
            })
        );

        return { date: args.date, staff: results.filter(Boolean) };
    },
};
