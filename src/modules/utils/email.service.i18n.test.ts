// The owner/staff-facing emails speak the recipient's language: every template renders in Hindi and Arabic with no raw key or
// unfilled {{placeholder}} left in it, Arabic is right-to-left, and English stays exactly as it always was.
const sendMail = jest.fn();
jest.mock("nodemailer", () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => sendMail(...a), verify: jest.fn() }) } }));
jest.mock("../../config/env", () => ({
    __esModule: true,
    default: { smtp: { host: "h", port: 587, user: "u", pass: "p", from: "from@x.com" }, otp: { expMinutes: 10 }, frontend: { url: "https://app.example" } },
}));
const poolQuery = jest.fn();
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: unknown[]) => poolQuery(...a) } }));

import { emailService } from "./email.service";
import { invalidateSalonLanguage } from "../../config/language";

type Svc = typeof emailService;
const cases: Array<[string, (s: Svc, x: object) => Promise<unknown>]> = [
    ["otp", (s, x) => (s as any).sendOtpEmail("a@b.com", "123456", x)],
    ["password reset code", (s, x) => (s as any).sendPasswordResetOtpEmail("a@b.com", "654321", x)],
    ["password reset done", (s, x) => s.sendPasswordResetConfirmationEmail({ to: "a@b.com", fullName: "Asha Rao", resetAt: new Date("2026-03-04T10:15:00Z"), ...x })],
    ["welcome", (s, x) => s.sendWelcomeEmail({ to: "a@b.com", fullName: "Asha Rao", salonName: "Glow & Co", ...x })],
    ["new appointment", (s, x) => s.sendNewAppointmentEmail({ to: "a@b.com", salonName: "Glow", clientName: "Meera", services: "Cut", date: "04-03-2026", time: "10:30", appointmentId: "abcdef123456", ...x })],
    ["appointment cancelled", (s, x) => s.sendAppointmentCancelledOwnerEmail({ to: "a@b.com", salonName: "Glow", clientName: "Meera", date: "04-03-2026", time: "10:30", appointmentId: "abcdef123456", ...x })],
    ["new payment", (s, x) => s.sendNewPaymentEmail({ to: "a@b.com", salonName: "Glow", clientName: "Meera", amount: "1500", currency: "AED", paymentMethod: "Cash", invoiceId: "INV-1", ...x })],
    ["new client", (s, x) => s.sendNewClientEmail({ to: "a@b.com", salonName: "Glow", clientName: "Meera", clientEmail: "m@x.com", clientPhone: "5551234", ...x })],
    ["staff login", (s, x) => s.sendStaffLoginEmail({ to: "a@b.com", salonName: "Glow", staffName: "Ravi", staffEmail: "r@x.com", loginTime: "10:30", ...x })],
    ["salon deactivated", (s, x) => s.sendSalonDeactivatedEmail({ to: "a@b.com", salonName: "Glow", ownerName: "Asha", ...x })],
    ["staff invitation", (s, x) => s.sendStaffInvitation({ to: "a@b.com", token: "tok", staffFirstName: "Ravi", salonName: "Glow", ...x })],
    ["daily summary", (s, x) => s.sendDailySummaryEmail({ to: "a@b.com", currency: "AED", summary: { reconciliationAmount: -5, remarks: "Short" }, ...x })],
    ["salary receipt", (s, x) => s.sendSalaryReceiptEmail({ to: "a@b.com", staffFirstName: "Ravi", salonName: "Glow", periodLabel: "1 to 31", netPay: 25000, currency: "AED", pdfBuffer: Buffer.from("x"), pdfFilename: "r.pdf", ...x })],
];

async function render(run: (s: Svc, x: object) => Promise<unknown>, extra: object) {
    sendMail.mockClear();
    await run(emailService, extra);
    const arg = sendMail.mock.calls[0][0];
    return { subject: arg.subject as string, html: arg.html as string };
}
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
// the two verification-code mails are bare <div> fragments with no <html> tag, so only their dir can be checked
const FRAGMENTS = new Set(["otp", "password reset code"]);
const DEVANAGARI = /[ऀ-ॿ]/;
const ARABIC = /[؀-ۿ]/;

describe("owner and staff emails", () => {
    it.each(cases)("%s: Hindi is Devanagari, no raw keys or unfilled placeholders", async (name, run) => {
        const { subject, html } = await render(run, { language: "hi" });
        for (const out of [subject, text(html)]) {
            expect(out).not.toMatch(/\{\{|\}\}/);
            expect(out).not.toMatch(/\bemail\.[a-zA-Z]+\.[a-zA-Z]+/);
        }
        expect(DEVANAGARI.test(text(html))).toBe(true);
        if (!FRAGMENTS.has(name)) expect(html).toContain('lang="hi"');
        expect(html).not.toContain('dir="rtl"');
    });

    it.each(cases)("%s: Arabic is Arabic script, right-to-left, no raw keys or unfilled placeholders", async (name, run) => {
        const { subject, html } = await render(run, { language: "ar" });
        for (const out of [subject, text(html)]) {
            expect(out).not.toMatch(/\{\{|\}\}/);
            expect(out).not.toMatch(/\bemail\.[a-zA-Z]+\.[a-zA-Z]+/);
        }
        expect(ARABIC.test(text(html))).toBe(true);
        if (!FRAGMENTS.has(name)) expect(html).toContain('lang="ar" dir="rtl"');
        expect(html).toMatch(/<(body|div)[^>]* dir="rtl"|<body dir="rtl"/);
    });

    it.each(cases)("%s: English has no dir attribute and no native script", async (_n, run) => {
        const { html } = await render(run, {});
        expect(html).not.toContain('dir="rtl"');
        expect(DEVANAGARI.test(html) || ARABIC.test(html)).toBe(false);
    });

    it("keeps names the person typed, untouched, inside the translated sentence", async () => {
        const { html } = await render(cases[3][1], { language: "ar" });
        expect(html).toContain("Asha Rao");
        expect(html).toContain("Glow & Co");
    });

    it("uses the salon's saved language when only a salon id is given, and English when the lookup finds nothing", async () => {
        invalidateSalonLanguage("salon-1");
        poolQuery.mockResolvedValueOnce({ rows: [{ language: "ar" }] });
        const arabic = await render(cases[4][1], { salonId: "salon-1" });
        expect(arabic.html).toContain('lang="ar" dir="rtl"');

        invalidateSalonLanguage("salon-2");
        poolQuery.mockRejectedValueOnce(new Error('column "language" does not exist'));
        const english = await render(cases[4][1], { salonId: "salon-2" });
        expect(english.html).not.toContain('dir="rtl"');
        expect(english.subject).toBe("New Appointment Booked — Meera");
    });

    it("an explicit language beats the salon's", async () => {
        invalidateSalonLanguage("salon-3");
        poolQuery.mockResolvedValueOnce({ rows: [{ language: "ar" }] });
        const hindi = await render(cases[4][1], { salonId: "salon-3", language: "hi" });
        expect(hindi.html).toContain('lang="hi"');
    });
});
