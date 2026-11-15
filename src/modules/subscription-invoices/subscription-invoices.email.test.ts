// The subscription payment email: a Razorpay-paid invoice gets the "Payment Successful" email with the GST invoice PDF attached,
// exactly once per invoice (concurrent calls and retries included), and a failed send can be retried without making a second
// invoice or PDF. Unpaid / void invoices are never emailed.
import os from "os";
import path from "path";
import { promises as fsp } from "fs";

const PDF_DIR = path.join(os.tmpdir(), `salonox-invoice-pdfs-${process.pid}`);
process.env.INVOICE_PDF_DIR = PDF_DIR;

const rendered = jest.fn(async () => Buffer.from("%PDF-test"));
jest.mock("../../config/puppeteer", () => ({ renderHtmlToPdf: (...a: unknown[]) => (rendered as any)(...a) }));
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));
jest.mock("../plan-pricing/plan-pricing.service", () => ({ GST_PERCENT: 18 }));
jest.mock("../subscription-pricing/billing-schema", () => ({ billingSchemaReady: async () => true }));
jest.mock("../utils/email.service", () => ({
    emailService: {
        sendPaymentSuccessEmail: jest.fn(), sendPaymentReceivedOnboardingPendingEmail: jest.fn(),
        sendSubscriptionInvoiceEmail: jest.fn(), sendSubscriptionPaymentReceivedEmail: jest.fn(),
    },
}));

// A tiny in-memory stand-in for the invoice repository, including its atomic "claim".
const state = { invoice: null as any, ctx: null as any, pdfPath: null as string | null };
const repo = {
    findById: jest.fn(async () => (state.invoice ? { ...state.invoice } : null)),
    paymentEmailContext: jest.fn(async () => state.ctx),
    getPdfPath: jest.fn(async () => state.pdfPath),
    setPdfPath: jest.fn(async (_id: string, p: string) => { state.pdfPath = p; }),
    claimEmail: jest.fn(async () => { if (state.invoice.emailed_at) return false; state.invoice.emailed_at = "now"; return true; }),
    releaseEmailClaim: jest.fn(async () => { state.invoice.emailed_at = null; }),
    salonContact: jest.fn(async () => ({ business_name: "Glow", address: "1 Main St", phone: "999", email: "s@x.com" })),
    createFromPayment: jest.fn(),
};
jest.mock("./subscription-invoices.repository", () => ({ subscriptionInvoicesRepository: new Proxy({}, { get: (_t, k) => (repo as any)[k] }) }));

import { subscriptionInvoicesService as svc } from "./subscription-invoices.service";
import { emailService } from "../utils/email.service";

const sendPaid = emailService.sendPaymentSuccessEmail as jest.Mock;
const sendPending = emailService.sendPaymentReceivedOnboardingPendingEmail as jest.Mock;
const sendManual = emailService.sendSubscriptionInvoiceEmail as jest.Mock;

const baseInvoice = () => ({
    id: "inv-1", invoice_no: "FY2627/01", salon_id: "s1", payment_id: "pay-row-1", status: "paid", emailed_at: null,
    plan_name: "SalonOx Basic", billing_cycle: "yearly", currency: "INR", total: 11313.84, subtotal: 9588, gst_percent: 18, gst_amount: 1725.84,
    transaction_id: "pay_ABC123", issued_at: "2026-11-05T05:00:00Z", period_start: "2026-11-05", period_end: "2027-11-05",
    salon_name: "Glow Salon", owner_email: "owner@glow.com", payment_mode: "card", credit_amount: 0, description: null,
});
const paidCtx = (over: object = {}) => ({ owner_name: "Asha Rao", owner_first_name: "Asha", onboarding_completed: true, paid_at: "2026-11-05T05:00:00Z", payment_status: "paid", ...over });

beforeEach(() => {
    jest.clearAllMocks();
    state.invoice = baseInvoice();
    state.ctx = paidCtx();
    state.pdfPath = null;
});
afterAll(async () => { await fsp.rm(PDF_DIR, { recursive: true, force: true }); });

describe("emailInvoice - Razorpay-paid invoice", () => {
    it("sends the Payment Successful email with the invoice PDF and the payment details", async () => {
        await svc.emailInvoice("inv-1");
        expect(sendPaid).toHaveBeenCalledTimes(1);
        const m = sendPaid.mock.calls[0][0];
        expect(m).toMatchObject({
            to: "owner@glow.com", ownerName: "Asha", salonName: "Glow Salon", planName: "SalonOx Basic", billingCycle: "Yearly",
            paymentId: "pay_ABC123", pdfFilename: "FY2627-01.pdf",
        });
        expect(m.amount).toContain("11,313.84");
        expect(m.startDate).toContain("2026");
        expect(m.endDate).toContain("2027");
        expect(Buffer.isBuffer(m.pdfBuffer)).toBe(true);
        expect(sendManual).not.toHaveBeenCalled();
    });

    it("renders the PDF for the email and does not store it anywhere", async () => {
        await svc.emailInvoice("inv-1");
        expect(rendered).toHaveBeenCalledTimes(1);
        expect(repo.setPdfPath).not.toHaveBeenCalled();
        await expect(fsp.readdir(PDF_DIR)).rejects.toThrow();   // no storage folder is created
    });

    it("sends only one email when called many times at once", async () => {
        await Promise.all([svc.emailInvoice("inv-1"), svc.emailInvoice("inv-1"), svc.emailInvoice("inv-1")]);
        expect(sendPaid).toHaveBeenCalledTimes(1);
    });

    it("does not email again once it has been sent", async () => {
        await svc.emailInvoice("inv-1");
        await svc.emailInvoice("inv-1");
        expect(sendPaid).toHaveBeenCalledTimes(1);
    });

    it("retries a failed send without making a second invoice or PDF", async () => {
        sendPaid.mockRejectedValueOnce(new Error("smtp down"));
        await svc.emailInvoice("inv-1");
        expect(repo.releaseEmailClaim).toHaveBeenCalledWith("inv-1");
        expect(state.invoice.emailed_at).toBeNull();

        await svc.emailInvoice("inv-1");
        expect(sendPaid).toHaveBeenCalledTimes(2);
        expect(state.invoice.emailed_at).toBe("now");
        expect(rendered).toHaveBeenCalledTimes(2);            // rendered again for the retry (nothing is stored)
        expect(repo.createFromPayment).not.toHaveBeenCalled(); // no new invoice
    });

    it("sends the 'continue onboarding' payment email, with the invoice, when onboarding is unfinished", async () => {
        state.ctx = paidCtx({ onboarding_completed: false });
        await svc.emailInvoice("inv-1");
        expect(sendPaid).not.toHaveBeenCalled();
        expect(sendPending).toHaveBeenCalledTimes(1);
        const m = sendPending.mock.calls[0][0];
        expect(m).toMatchObject({
            to: "owner@glow.com", ownerName: "Asha", salonName: "Glow Salon", planName: "SalonOx Basic",
            paymentId: "pay_ABC123", pdfFilename: "FY2627-01.pdf",
        });
        expect(m.amount).toContain("11,313.84");
        expect(Buffer.isBuffer(m.pdfBuffer)).toBe(true);
    });

    it("sends only one of the two payment emails, once, even when called repeatedly", async () => {
        state.ctx = paidCtx({ onboarding_completed: false });
        await Promise.all([svc.emailInvoice("inv-1"), svc.emailInvoice("inv-1")]);
        await svc.emailInvoice("inv-1");
        expect(sendPending).toHaveBeenCalledTimes(1);
        expect(sendPaid).not.toHaveBeenCalled();
    });

    it.each([
        ["a pending payment", () => { state.ctx = paidCtx({ payment_status: "pending" }); }],
        ["a failed payment", () => { state.ctx = paidCtx({ payment_status: "failed" }); }],
        ["a void invoice", () => { state.invoice.status = "void"; }],
    ])("sends nothing for %s", async (_name, arrange) => {
        arrange();
        await svc.emailInvoice("inv-1");
        expect(sendPaid).not.toHaveBeenCalled();
        expect(repo.claimEmail).not.toHaveBeenCalled();
    });

    it("skips quietly when the salon owner has no email, without rendering a PDF", async () => {
        state.invoice.owner_email = null;
        await svc.emailInvoice("inv-1");
        expect(sendPaid).not.toHaveBeenCalled();
        expect(rendered).not.toHaveBeenCalled();
    });
});

describe("emailInvoice - manual / granted-plan bill (no Razorpay payment)", () => {
    it("keeps the plain invoice email", async () => {
        state.invoice.payment_id = null;
        state.ctx = null;
        await svc.emailInvoice("inv-1");
        expect(sendManual).toHaveBeenCalledTimes(1);
        expect(sendPaid).not.toHaveBeenCalled();
    });
});
