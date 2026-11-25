const trigger = jest.fn();
jest.mock("../whatsapp-automation/whatsapp-automation.service", () => ({ whatsappAutomationService: { trigger: (...a: unknown[]) => trigger(...a) } }));
let template: any = { template_name: "subscription_expiring_x", language: "en" };
jest.mock("../whatsapp-automation/whatsapp-automation.repository", () => ({ whatsappAutomationRepository: { findTemplate: async () => template } }));
let cfg: any = { phone_number_id: "pn1", access_token: "tok" };
jest.mock("../marketing/whatsapp/config/config.repository", () => ({ configRepository: { findBySalonId: async () => cfg } }));
let platform: string | null = "platform-salon";
jest.mock("../client-announcements/platform-salon", () => ({ getPlatformSalonId: async () => platform }));

import { sendExpiryWhatsApp } from "./subscription-expiry-whatsapp";
import { DEFAULT_PURCHASE_TEMPLATES, EVENT_VARIABLE_NAMES, daysRemainingValue, toMetaNumberedBody, validateNamedPlaceholders } from "../whatsapp-automation/wa-automation-defaults";

const base = { ownerPhone: "9876543210", ownerName: "Asha", salonName: "Glow", planName: "Basic", expiryDate: "10 Nov 2026", daysRemaining: 3, referenceId: "sub:end:3" };

// The wording first approved on Meta (the whole phrase goes in the last slot), and the current one (the number only).
const OLD_WORDING = "Hi {{owner_name}}, your SalonOx subscription ({{plan_name}}) for {{salon_name}} expires on {{expiry_date}}, {{days_left}}. Renew from Settings > Billing.";
const NEW_WORDING = DEFAULT_PURCHASE_TEMPLATES.subscription_expiring.bodyText;

beforeEach(() => {
    trigger.mockReset(); trigger.mockResolvedValue({});
    template = { template_name: "subscription_expiring_x", language: "en", body_text: NEW_WORDING };
    cfg = { phone_number_id: "pn1", access_token: "tok" }; platform = "platform-salon";
});

describe("the subscription_expiring wording", () => {
    it("is the SalonOx coordinator message, with every variable used and valid", () => {
        expect(NEW_WORDING).toContain("Hi *{{customer_name}}* 👋");
        expect(NEW_WORDING).toContain("Your *SalonOx {{plan_name}}* subscription for *{{salon_name}}* is expiring on *{{expiry_date}}* (in {{days_remaining}} days).");
        expect(NEW_WORDING).toContain("🔄 *Renew Subscription:* Settings → Billing");
        expect(NEW_WORDING).toContain("*SalonOx Coordinator*");
        expect(NEW_WORDING.endsWith("*Team SalonOx*")).toBe(true);
        expect(() => validateNamedPlaceholders(NEW_WORDING, "subscription_expiring")).not.toThrow();
    });

    it("turns into Meta's numbered form with each variable in the slot the sender fills", () => {
        expect(EVENT_VARIABLE_NAMES.subscription_expiring).toEqual(["customer_name", "salon_name", "plan_name", "expiry_date", "days_remaining"]);
        const meta = toMetaNumberedBody(NEW_WORDING, "subscription_expiring");
        expect(meta).toContain("Hi *{{1}}* 👋");                                  // owner name
        expect(meta).toContain("*SalonOx {{3}}* subscription for *{{2}}*");        // plan, salon
        expect(meta).toContain("expiring on *{{4}}* (in {{5}} days)");             // end date, days
        expect(meta).not.toMatch(/\{\{[a-z_]+\}\}/);                                // no named placeholder left behind
    });
});

describe("daysRemainingValue", () => {
    it("gives the bare number when the live wording writes the unit itself", () => {
        expect(daysRemainingValue(NEW_WORDING, 5)).toBe("5");
        expect(daysRemainingValue(NEW_WORDING, 1)).toBe("1");
        expect(daysRemainingValue(NEW_WORDING, 0)).toBe("0");
        expect(daysRemainingValue(NEW_WORDING, -2)).toBe("0");
    });

    it("keeps giving the whole phrase to the wording that was approved first, so it never reads 'expires on 1 Dec, 3'", () => {
        expect(daysRemainingValue(OLD_WORDING, 5)).toBe("in 5 days");
        expect(daysRemainingValue(OLD_WORDING, 1)).toBe("in 1 day");
        expect(daysRemainingValue(OLD_WORDING, 0)).toBe("today");
        expect(daysRemainingValue(null, 3)).toBe("in 3 days");
        expect(daysRemainingValue(undefined, 3)).toBe("in 3 days");
    });

    it("recognises the unit written either way round the variable name", () => {
        expect(daysRemainingValue("ends (in {{ days_left }} days)", 2)).toBe("2");
        expect(daysRemainingValue("ends (in {{days_remaining}} day)", 2)).toBe("2");
        expect(daysRemainingValue("ends {{days_remaining}}", 2)).toBe("in 2 days");   // no unit around it: it carries the phrase
    });
});

describe("sendExpiryWhatsApp", () => {
    it("hands the message to the automation sender as the platform salon, variables in template order, once per reference", async () => {
        expect(await sendExpiryWhatsApp(base)).toEqual({ sent: true });
        expect(trigger).toHaveBeenCalledTimes(1);
        expect(trigger.mock.calls[0][0]).toMatchObject({
            salonId: "platform-salon", eventType: "subscription_expiring", clientId: null, phone: "9876543210",
            variables: { "1": "Asha", "2": "Glow", "3": "Basic", "4": "10 Nov 2026", "5": "3" },
            referenceId: "sub:end:3", dedupeByReference: true, whatsappOnly: true,
        });
    });
    it("still sends the phrase while the first-approved wording is the live one", async () => {
        template = { ...template, body_text: OLD_WORDING };
        await sendExpiryWhatsApp(base);
        expect(trigger.mock.calls[0][0].variables["5"]).toBe("in 3 days");
        await sendExpiryWhatsApp({ ...base, daysRemaining: 0 });
        expect(trigger.mock.calls[1][0].variables["5"]).toBe("today");
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
