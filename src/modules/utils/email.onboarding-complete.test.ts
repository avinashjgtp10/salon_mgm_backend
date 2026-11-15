// Transactional emails sent after onboarding / payment / near expiry: onboarding complete, payment successful, expiry reminder.
const sendMail = jest.fn();
jest.mock("nodemailer", () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...a: unknown[]) => sendMail(...a), verify: jest.fn() }) } }));
jest.mock("../../config/env", () => ({
    __esModule: true,
    default: { smtp: { host: "h", port: 587, user: "u", pass: "p", from: "from@x.com" }, otp: { expMinutes: 10 }, frontend: { url: "https://app.example" } },
}));
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn() } }));
import { emailService } from "./email.service";

describe("sendOnboardingCompleteEmail", () => {
    beforeEach(() => sendMail.mockReset());

    it("sends the account details, the feature list and the dashboard link to the registered address", async () => {
        await emailService.sendOnboardingCompleteEmail({ to: "owner@salon.com", ownerName: "Asha", salonName: "Glow & Co", planName: "SalonOx Basic", validUntil: "5 Nov 2027" });
        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe("owner@salon.com");
        expect(mail.subject).toBe("Congratulations! Your SalonOx Onboarding is Complete");
        for (const v of ["Hi Asha,", "Congratulations! Your SalonOx onboarding process has been successfully completed.", "Your salon account is now ready",
            "Your Account Details:", "Salon Name", "Glow &amp; Co", "Subscription Plan", "SalonOx Basic", "Account Email", "owner@salon.com",
            "Subscription Valid Until", "5 Nov 2027",
            "Appointment &amp; Calendar Management", "Quick Sale &amp; Billing", "Client Management", "Staff Management", "Inventory Management",
            "Reports &amp; Analytics", "WhatsApp Marketing", "Online Booking",
            "Access Your SalonOx Dashboard:", 'href="https://app.example/login"', "Thank you for choosing SalonOx!", "Team SalonOx", "https://salonox.com"]) {
            expect(mail.html).toContain(v);
        }
    });

    it("leaves out the plan rows when the salon has no plan yet", async () => {
        await emailService.sendOnboardingCompleteEmail({ to: "owner@salon.com", ownerName: "Asha", salonName: "Glow", planName: null, validUntil: null });
        const html = sendMail.mock.calls[0][0].html;
        expect(html).not.toContain("Subscription Plan");
        expect(html).not.toContain("Subscription Valid Until");
        expect(html).toContain("Account Email");
    });

    it("escapes the name and falls back to a plain greeting", async () => {
        await emailService.sendOnboardingCompleteEmail({ to: "a@b.com", ownerName: "<b>x</b>", salonName: "S" });
        expect(sendMail.mock.calls[0][0].html).toContain("Hi &lt;b&gt;x&lt;/b&gt;,");
        sendMail.mockReset();
        await emailService.sendOnboardingCompleteEmail({ to: "a@b.com", ownerName: null, salonName: "S" });
        expect(sendMail.mock.calls[0][0].html).toContain("Hi there,");
    });
});

describe("sendPaymentSuccessEmail", () => {
    const base = {
        to: "owner@glow.com", ownerName: "Asha", salonName: "Glow & Co", planName: "SalonOx Basic", billingCycle: "Yearly",
        amount: "₹11,313.84", paymentId: "pay_ABC123", paymentDate: "5 Nov 2026", startDate: "5 Nov 2026", endDate: "5 Nov 2027",
        pdfBuffer: Buffer.from("%PDF"), pdfFilename: "FY2627-01.pdf",
    };
    beforeEach(() => sendMail.mockReset());

    it("has the fixed subject, every payment detail and the invoice attached", async () => {
        await emailService.sendPaymentSuccessEmail(base);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.subject).toBe("Payment Successful – Your SalonOx Subscription is Active!");
        expect(mail.to).toBe("owner@glow.com");
        for (const v of ["Hi Asha,", "Glow &amp; Co", "SalonOx Basic", "Yearly", "₹11,313.84", "pay_ABC123", "5 Nov 2026", "5 Nov 2027", "Subscription Start Date", "Subscription End Date", "official GST invoice is attached", "Team SalonOx", "https://salonox.in"]) {
            expect(mail.html).toContain(v);
        }
        expect(mail.attachments).toEqual([{ filename: "FY2627-01.pdf", content: base.pdfBuffer }]);
    });

    it("tells a finished owner to log in", async () => {
        await emailService.sendPaymentSuccessEmail(base);
        const html = sendMail.mock.calls[0][0].html;
        expect(html).toContain("Your SalonOx account is ready.");
        expect(html).toContain("Login Now");
        expect(html).not.toContain("still incomplete");
    });
});

describe("sendPaymentReceivedOnboardingPendingEmail", () => {
    const base = {
        to: "owner@glow.com", ownerName: "Asha", salonName: "Glow & Co", planName: "SalonOx Basic",
        amount: "₹11,313.84", paymentId: "pay_ABC123", paymentDate: "5 Nov 2026",
        pdfBuffer: Buffer.from("%PDF"), pdfFilename: "FY2627-01.pdf",
    };
    beforeEach(() => sendMail.mockReset());

    it("confirms the payment details and attaches the invoice", async () => {
        await emailService.sendPaymentReceivedOnboardingPendingEmail(base);
        const mail = sendMail.mock.calls[0][0];
        expect(mail.to).toBe("owner@glow.com");
        expect(mail.subject).toBe("Payment Received – Complete Your SalonOx Setup");
        for (const v of ["Hi Asha,", "Great news! Your SalonOx subscription payment has been successfully received.",
            "Your account has been created, and you are just one step away from getting started.",
            "Payment Details:", "Salon Name", "Glow &amp; Co", "Plan", "SalonOx Basic", "Amount Paid", "₹11,313.84", "Payment ID", "pay_ABC123", "Payment Date", "5 Nov 2026",
            "Your payment invoice is attached to this email for your reference.", "contact our support team", "Welcome to SalonOx!", "Team SalonOx", "https://salonox.com"]) {
            expect(mail.html).toContain(v);
        }
        expect(mail.attachments).toEqual([{ filename: "FY2627-01.pdf", content: base.pdfBuffer }]);
    });

    it("sends them back to finish onboarding", async () => {
        await emailService.sendPaymentReceivedOnboardingPendingEmail(base);
        const html = sendMail.mock.calls[0][0].html;
        expect(html).toContain("Complete Your Salon Setup");
        expect(html).toContain("We noticed that your onboarding process is still incomplete.");
        expect(html).toContain("Please use the link below to log in and continue from where you left off.");
        expect(html).toContain("Continue Onboarding");
        expect(html).toContain('href="https://app.example/login"');
        expect(html).toContain("Once you complete the onboarding process, you will be able to access your SalonOx dashboard");
        expect(html).not.toContain("Your SalonOx account is ready.");
    });

    it("escapes the name and falls back to a plain greeting", async () => {
        await emailService.sendPaymentReceivedOnboardingPendingEmail({ ...base, ownerName: "<i>x</i>" });
        expect(sendMail.mock.calls[0][0].html).toContain("Hi &lt;i&gt;x&lt;/i&gt;,");
        sendMail.mockReset();
        await emailService.sendPaymentReceivedOnboardingPendingEmail({ ...base, ownerName: null });
        expect(sendMail.mock.calls[0][0].html).toContain("Hi there,");
    });
});

describe("sendSubscriptionExpiryReminderEmail", () => {
    const base = { to: "owner@glow.com", ownerName: "Asha", salonName: "Glow & Co", planName: "SalonOx Basic", expiryDate: "10 Nov 2026", subscriptionUrl: "https://app.example/dashboard/settings/billing" };
    beforeEach(() => sendMail.mockReset());

    it("lists the subscription details, the renew link and the sign-off", async () => {
        await emailService.sendSubscriptionExpiryReminderEmail({ ...base, daysRemaining: 3 });
        const mail = sendMail.mock.calls[0][0];
        expect(mail.subject).toBe("Your SalonOx SalonOx Basic subscription expires in 3 days");
        for (const v of ["Hi Asha,", "approaching its expiry date", "Glow &amp; Co", "SalonOx Basic", "10 Nov 2026", "Days Remaining", "Your subscription will expire in 3 days.",
            "please renew your subscription before the expiry date", 'href="https://app.example/dashboard/settings/billing"', "Renew Your Subscription", "Team SalonOx", "https://salonox.com"]) {
            expect(mail.html).toContain(v);
        }
    });

    it("words the last day and the expiry day correctly", async () => {
        await emailService.sendSubscriptionExpiryReminderEmail({ ...base, daysRemaining: 1 });
        expect(sendMail.mock.calls[0][0].html).toContain("Your subscription will expire in 1 day.");
        sendMail.mockReset();
        await emailService.sendSubscriptionExpiryReminderEmail({ ...base, daysRemaining: 0 });
        const mail = sendMail.mock.calls[0][0];
        expect(mail.html).toContain("Your subscription will expire today.");
        expect(mail.subject).toBe("Your SalonOx SalonOx Basic subscription expires today");
    });
});
