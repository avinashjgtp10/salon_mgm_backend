export type Shift = { start_time: string | null; end_time: string | null; is_available: boolean };
export function istDate(now: Date): string {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
export function shiftWindow(date: string, shift: Shift | null) {
  if (!shift?.is_available || !shift.start_time || !shift.end_time) return null;
  const start = new Date(`${date}T${shift.start_time.slice(0, 5)}:00+05:30`);
  let end = new Date(`${date}T${shift.end_time.slice(0, 5)}:00+05:30`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end, reminderAt: new Date(start.getTime() + 15 * 60000) };
}
