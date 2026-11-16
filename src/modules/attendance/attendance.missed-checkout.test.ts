// A new attendance day can't start while an earlier one still has a check-in and no check-out, and that earlier day can only be
// closed by completing its check-out (never automatically).
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock("../../config/salonTimezone", () => ({ getSalonTimezone: async () => "Asia/Kolkata", salonWallClockAt: jest.fn() }));
jest.mock("../notifications/notifications.service", () => ({ notificationsService: {} }));
jest.mock("../../config/socket", () => ({ getIO: () => { throw new Error("no socket in tests"); }, salonRoom: jest.fn(), salonStaffRoom: jest.fn() }));
jest.mock("../../config/currency", () => ({ getSalonDateLocale: async () => "en-IN" }));
jest.mock("../../config/i18n", () => ({ salonTranslator: jest.fn() }));

const repo = {
    findByStaffAndDate: jest.fn(),
    findOpenSessionBefore: jest.fn(),
    findNextCheckInAfter: jest.fn(),
    findById: jest.fn(),
    getSettings: jest.fn(async () => null),
    hasApprovedLeave: jest.fn(async () => false),
    upsertCheckIn: jest.fn(async (p: any) => ({ id: "new", ...p })),
    upsertCheckOut: jest.fn(async (p: any) => ({ id: "old", ...p })),
};
jest.mock("./attendance.repository", () => ({ attendanceRepository: new Proxy({}, { get: (_t, k) => (repo as any)[k] }) }));

import { attendanceService } from "./attendance.service";

const open = {
    id: "old", salon_id: "s1", staff_id: "st1", staff_name: "Asha Rao", date: "2026-11-04",
    check_in: "2026-11-04T04:00:00.000Z", check_out: null, status: "present", breaks: [], break_count: 0, active_break: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    repo.findByStaffAndDate.mockResolvedValue(null);
    repo.findOpenSessionBefore.mockResolvedValue(null);
    repo.findNextCheckInAfter.mockResolvedValue(null);
    repo.findById.mockResolvedValue({ ...open });
});

describe("check-in with an unfinished earlier day", () => {
    it("still saves today's manual check-in (an open earlier day never blocks it)", async () => {
        repo.findOpenSessionBefore.mockResolvedValue({ ...open });
        await expect(attendanceService.checkIn("s1", { staff_id: "st1", check_in: "2026-11-05T04:00:00.000Z" } as any)).resolves.toBeTruthy();
        expect(repo.upsertCheckIn).toHaveBeenCalledTimes(1);
        // today's record only: the earlier day is not touched
        expect(repo.upsertCheckIn.mock.calls[0][0]).toMatchObject({ staffId: "st1", date: "2026-11-05" });
        expect(repo.upsertCheckOut).not.toHaveBeenCalled();
    });

    it("still saves a biometric / QR / GPS check-in", async () => {
        repo.findOpenSessionBefore.mockResolvedValue({ ...open });
        await attendanceService.push("s1", { staff_id: "st1", check_type: "in", source: "biometric", timestamp: "2026-11-05T04:00:00.000Z" } as any);
        expect(repo.upsertCheckIn).toHaveBeenCalled();
    });

    it("reports every earlier open day, oldest first, for the screen to ask about", async () => {
        const list = [{ attendance_id: "a", date: "2026-11-03" }, { attendance_id: "b", date: "2026-11-04" }];
        (repo as any).findOpenSessionsBefore = jest.fn().mockResolvedValue(list);
        await expect(attendanceService.openPreviousSessions("s1", "st1", "2026-11-05T04:00:00.000Z")).resolves.toEqual(list);
        expect((repo as any).findOpenSessionsBefore).toHaveBeenCalledWith("st1", "2026-11-05");
    });

    // Regression: the lookup used String(savedRow.date), and pg returns that column as a JS Date -> "Mon Nov 16", which Postgres rejects,
    // so a check-in that had already been saved answered 500. The day must be a plain YYYY-MM-DD derived from the check-in instant.
    it("derives a plain YYYY-MM-DD from the check-in instant (10:27 AM IST on 16 Nov), never a Date string", async () => {
        (repo as any).findOpenSessionsBefore = jest.fn().mockResolvedValue([]);
        await attendanceService.openPreviousSessions("s1", "st1", "2026-11-16T04:57:00.000Z");
        const day = (repo as any).findOpenSessionsBefore.mock.calls[0][1];
        expect(day).toBe("2026-11-16");
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("allows the check-in when no earlier day is open", async () => {
        await expect(attendanceService.checkIn("s1", { staff_id: "st1", check_in: "2026-11-05T04:00:00.000Z" } as any)).resolves.toBeTruthy();
        expect(repo.upsertCheckIn).toHaveBeenCalledTimes(1);
    });
});

describe("completeMissedCheckOut", () => {
    it("fills in only the check-out, with hours from the real times", async () => {
        const out = "2026-11-04T12:30:00.000Z";   // 8.5h after the check-in
        await attendanceService.completeMissedCheckOut("s1", "old", out);
        const p = repo.upsertCheckOut.mock.calls[0][0];
        expect(p).toMatchObject({ staffId: "st1", date: "2026-11-04", checkOut: out });
        expect(p.hoursWorked).toBeCloseTo(8.5, 1);
    });

    it("rejects a check-out before the check-in", async () => {
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T03:00:00.000Z")).rejects.toMatchObject({ code: "INVALID_CHECKOUT" });
        expect(repo.upsertCheckOut).not.toHaveBeenCalled();
    });

    it("rejects a check-out in the future", async () => {
        await expect(attendanceService.completeMissedCheckOut("s1", "old", new Date(Date.now() + 3600_000).toISOString())).rejects.toMatchObject({ code: "INVALID_CHECKOUT" });
    });

    it("rejects a check-out that runs into the next check-in", async () => {
        repo.findNextCheckInAfter.mockResolvedValue("2026-11-04T10:00:00.000Z");
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:00:00.000Z")).rejects.toMatchObject({ code: "OVERLAPPING_SESSION" });
    });

    it("does not touch a day that already has a check-out, or another salon's record", async () => {
        repo.findById.mockResolvedValueOnce({ ...open, check_out: "2026-11-04T12:00:00.000Z" });
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T13:00:00.000Z")).rejects.toMatchObject({ code: "ALREADY_CHECKED_OUT" });
        repo.findById.mockResolvedValueOnce({ ...open, salon_id: "other" });
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T13:00:00.000Z")).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(repo.upsertCheckOut).not.toHaveBeenCalled();
    });
});

// An earlier day left with an UNFINISHED BREAK: never closed by ignoring the break, only by ending it (or discarding it) in the same
// operation as the check-out.
describe("completeMissedCheckOut with an unfinished break", () => {
    const brk = { id: "b1", attendance_id: "old", actual_start: "2026-11-04T08:00:00.000Z", actual_end: null };
    const withBreak = () => ({ ...open, breaks: [{ ...brk }], break_count: 1, active_break: { ...brk } });
    (repo as any).closeDayWithBreakFix = jest.fn(async (p: any) => ({ id: "old", ...p }));

    beforeEach(() => {
        (repo as any).closeDayWithBreakFix.mockClear();
        repo.findById.mockResolvedValue(withBreak());
    });

    it("still refuses with ON_BREAK, and says which break is open", async () => {
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z")).rejects.toMatchObject({
            code: "ON_BREAK", details: { open_break: { id: "b1", actual_start: "2026-11-04T08:00:00.000Z" } },
        });
        expect(repo.upsertCheckOut).not.toHaveBeenCalled();
        expect((repo as any).closeDayWithBreakFix).not.toHaveBeenCalled();
    });

    it("ends the break and checks out in one operation, with the break taken off the worked hours", async () => {
        await attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z", undefined, { action: "end", breakEnd: "2026-11-04T09:00:00.000Z" });
        const p = (repo as any).closeDayWithBreakFix.mock.calls[0][0];
        expect(p).toMatchObject({ attendanceId: "old", breakId: "b1", breakAction: "end", breakEnd: "2026-11-04T09:00:00.000Z", checkOut: "2026-11-04T12:30:00.000Z" });
        expect(p.hoursWorked).toBeCloseTo(8.5 - 1, 1);   // 04:00 -> 12:30 = 8.5h, minus the 1h break
        expect(repo.upsertCheckOut).not.toHaveBeenCalled();
    });

    it("discards a break that was never taken (no fake end time)", async () => {
        await attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z", undefined, { action: "discard" });
        const p = (repo as any).closeDayWithBreakFix.mock.calls[0][0];
        expect(p).toMatchObject({ breakAction: "discard", breakId: "b1" });
        expect(p.hoursWorked).toBeCloseTo(8.5, 1);
    });

    it("rejects a break end that is not after the break start", async () => {
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z", undefined, { action: "end", breakEnd: "2026-11-04T07:00:00.000Z" }))
            .rejects.toMatchObject({ code: "INVALID_BREAK" });
        expect((repo as any).closeDayWithBreakFix).not.toHaveBeenCalled();
    });

    it("rejects a break end that is not before the check-out", async () => {
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z", undefined, { action: "end", breakEnd: "2026-11-04T12:30:00.000Z" }))
            .rejects.toMatchObject({ code: "INVALID_BREAK" });
    });

    it("rejects a check-out that is not after a break that already ended", async () => {
        repo.findById.mockResolvedValue({ ...open, breaks: [{ id: "b0", actual_start: "2026-11-04T07:00:00.000Z", actual_end: "2026-11-04T13:00:00.000Z" }], break_count: 1, active_break: null });
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z")).rejects.toMatchObject({ code: "INVALID_CHECKOUT" });
    });

    it("refuses a break correction when the day has no unfinished break", async () => {
        repo.findById.mockResolvedValue({ ...open });
        await expect(attendanceService.completeMissedCheckOut("s1", "old", "2026-11-04T12:30:00.000Z", undefined, { action: "discard" }))
            .rejects.toMatchObject({ code: "NO_OPEN_BREAK" });
    });
});
