import { AppError } from "../../middleware/error.middleware";
import { staffAvailabilityRepository } from "./staffAvailability.repository";

type TimeRange = { start: string; end: string };

const toMinutes = (value: string): number => {
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};

const toTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const overlaps = (slot: TimeRange, range: TimeRange) =>
  toMinutes(slot.start) < toMinutes(range.end) && toMinutes(slot.end) > toMinutes(range.start);

const getTodayInSalonTime = (): { date: string; minutes: number } => {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const time = now.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return { date, minutes: toMinutes(time) };
};

export const staffAvailabilityService = {
  async getAvailability(params: { staffId: string; salonId: string; date: string; serviceId?: string; branchId?: string }) {
    const context = await staffAvailabilityRepository.findContext(
      params.staffId, params.salonId, params.date, params.branchId,
    );
    if (!context) throw new AppError(404, "Staff member or branch not found", "NOT_FOUND");

    const schedule = context.schedule;
    const workingHours = schedule
      ? (schedule.is_available && schedule.start_time && schedule.end_time
        ? { start: String(schedule.start_time).slice(0, 5), end: String(schedule.end_time).slice(0, 5) }
        : null)
      : (context.branchTiming && !context.branchTiming.is_closed
        ? { start: String(context.branchTiming.opening_time).slice(0, 5), end: String(context.branchTiming.closing_time).slice(0, 5) }
        : null);

    const appointments = context.appointments.map((appointment) => ({
      id: appointment.id,
      start: new Date(appointment.scheduled_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
      end: new Date(new Date(appointment.scheduled_at).getTime() + Number(appointment.duration_minutes) * 60000)
        .toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
      status: appointment.status,
    }));
    const blockedTimes = context.blockedTimes.map((block) => ({
      start: String(block.start_time).slice(0, 5),
      end: String(block.end_time).slice(0, 5),
      reason: block.reason,
    }));
    const leaves = context.leaves.map((leave) => ({
      id: leave.id,
      startDate: leave.start_date,
      endDate: leave.end_date,
      type: leave.leave_type,
      status: leave.status,
      reason: leave.reason,
    }));

    const availableSlots: string[] = [];
    if (workingHours && context.leaves.length === 0) {
      const start = toMinutes(workingHours.start);
      const end = toMinutes(workingHours.end);
      const today = getTodayInSalonTime();
      const earliestSlot = params.date < today.date ? end : params.date === today.date ? Math.max(start, today.minutes) : start;
      for (let cursor = start; cursor + context.intervalMinutes <= end; cursor += context.intervalMinutes) {
        if (cursor < earliestSlot) continue;
        const slot = { start: toTime(cursor), end: toTime(cursor + context.intervalMinutes) };
        const occupied = appointments.some((appointment) => overlaps(slot, appointment))
          || blockedTimes.some((block) => overlaps(slot, block));
        if (!occupied) availableSlots.push(slot.start);
      }
    }

    return {
      staff: {
        id: context.staff.id,
        name: [context.staff.first_name, context.staff.last_name].filter(Boolean).join(" "),
        avatar: context.staff.avatar_url,
        designation: context.staff.designation,
      },
      date: params.date,
      workingHours,
      blockedTimes,
      leaves,
      appointments,
      availableSlots,
    };
  },
};
