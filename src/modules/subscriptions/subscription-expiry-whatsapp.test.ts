const trigger = jest.fn();
jest.mock("../whatsapp-automation/whatsapp-automation.service", () => ({ whatsappAutomationService: { trigger: (...a: unknown[]) => trigger(...a) } }));
let template: any = { template_name: "subscription_expiring_x", language: "en" };
jest.mock("../whatsapp-automation/whatsapp-automation.repository", () => ({ whatsappAutomationRepository: { findTemplate: async () => template } }));
let cfg: any = { phone_number_id: "pn1", access_token: "tok" };
jest.mock("../marketing/whatsapp/config/config.repository", () => ({ configRepository: { findBySalonId: async () => cfg } }));
let platform: string | null = "platform-salon";
jest.mock("../client-announcements/platform-salon", () => ({ getPlatformSalonId: async () => platform }));

import { daysText, sendExpiryWhatsApp } from "./subscription-expiry-whatsapp";

const base = { ownerPhone: "9876543210", ownerName: "Asha", salonName: "Glow", planName: "Basic", expiryDate: "10 Nov 2026", daysRemaining: 3, referenceId: "sub:end:3" };

beforeEach(() => {
    trigger.mockReset(); trigger.mockResolvedValue({});
    template = { template_name: "subscription_expiring_x", language: "en" };
    cfg = { phone_number_id: "pn1", access_token: "tok" }; platform = "platform-salon";
});

describe("daysText", () => {
    it("words the days left", () => {
        expect(daysText(0)).toBe("today");
        expect(daysText(1)).toBe("in 1 day");
        expect(daysText(5)).toBe("in 5 days");
    });
});

describe("sendExpiryWhatsApp", () => {
    it("hands the message to the automation sender as the platform salon, variables in template order, once per reference", async () => {
        expect(await sendExpiryWhatsApp(base)).toEqual({ sent: true });
        expect(trigger).toHaveBeenCalledTimes(1);
        expect(trigger.mock.calls[0][0]).toMatchObject({
            salonId: "platform-salon", eventType: "subscription_expiring", clientId: null, phone: "9876543210",
            variables: { "1": "Asha", "2": "Glow", "3": "Basic", "4": "10 Nov 2026", "5": "in 3 days" },
            referenceId: "sub:end:3", dedupeByReference: true, whatsappOnly: true,
        });
    });
    it("falls back to 'there' with no owner name", async () => {
        await sendExpiryWhatsApp({ ...base, ownerName: null });
        expect(trigger.mock.calls[0][0].variables["1"]).toBe("there");
    });
    it("skips with no phone", async () => {
        expect(await sendExpiryWhatsApp({ ...base, ownerPhone: "" })).toEqual({ sent: false, skipped: "no_phone" });
        expect(trigger).not.toHaveBeenCalled();
    });
    it("skips when the platform number is not connected", async () => {
        cfg = null;
        expect(await sendExpiryWhatsApp(base)).toEqual({ sent: false, skipped: "platform_not_configured" });
        cfg = { phone_number_id: "pn1", access_token: "tok" }; platform = null;
        expect(await sendExpiryWhatsApp(base)).toEqual({ sent: false, skipped: "platform_not_configured" });
        expect(trigger).not.toHaveBeenCalled();
    });
    it("skips (retried next sweep) until the template is approved in Automated Messages", async () => {
        template = null;
        expect(await sendExpiryWhatsApp(base)).toEqual({ sent: false, skipped: "template_pending" });
        expect(trigger).not.toHaveBeenCalled();
    });
});
