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
    it("refuses a manual check-in and says which day is open", async () => {
        repo.findOpenSessionBefore.mockResolvedValue({ ...open });
        await expect(attendanceService.checkIn("s1", { staff_id: "st1", check_in: "2026-11-05T04:00:00.000Z" } as any)).rejects.toMatchObject({
            statusCode: 409,
            code: "PREVIOUS_CHECKOUT_PENDING",
            message: expect.stringContaining("04 Nov 2026"),
            details: { attendance_id: "old", staff_name: "Asha Rao", date: "2026-11-04" },
        });
        expect(repo.upsertCheckIn).not.toHaveBeenCalled();
    });

    it("refuses a biometric / QR / GPS check-in the same way", async () => {
        repo.findOpenSessionBefore.mockResolvedValue({ ...open });
        await expect(attendanceService.push("s1", { staff_id: "st1", check_type: "in", source: "biometric", timestamp: "2026-11-05T04:00:00.000Z" } as any))
            .rejects.toMatchObject({ code: "PREVIOUS_CHECKOUT_PENDING" });
        expect(repo.upsertCheckIn).not.toHaveBeenCalled();
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
