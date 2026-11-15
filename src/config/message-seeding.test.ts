// What a salon is seeded with when its customer-message templates are first created (WhatsApp, SMS, email), by language.
// The English path must stay byte-identical — those bodies are what Meta approved — while Hindi and Arabic salons get
// their own wording, the right currency sign, and (WhatsApp) a template submitted in their language.
const calls: Array<{ sql: string; params: any[] }> = [];
let salonRow: any = { currency: "AED", language: "ar" };

jest.mock("./database", () => ({
    __esModule: true,
    default: {
        query: async (sql: string, params: any[] = []) => {
            calls.push({ sql, params });
            if (/FROM salons/.test(sql)) return { rows: [salonRow] };
            if (/^\s*SELECT \* FROM (wa_automation_templates|notification_channel_templates)/.test(sql)) return { rows: [] };
            if (/INSERT INTO/.test(sql)) return { rows: [{ inserted: true }] };
            return { rows: [] };
        },
    },
}));

import { whatsappAutomationRepository } from "../modules/whatsapp-automation/whatsapp-automation.repository";
import { notificationChannelsRepository } from "../modules/notification-channels/notification-channels.repository";
import { invalidateSalonLanguage } from "./language";
import { invalidateSalonCurrency } from "./currency";

const lastInsert = () => calls.filter((c) => /INSERT INTO/.test(c.sql)).pop()!.params;

beforeEach(() => {
    calls.length = 0;
    invalidateSalonLanguage("s1");
    invalidateSalonCurrency("s1");
});

describe("seeding a salon's customer-message templates", () => {
    it("English salon: WhatsApp copy is the untouched English default", async () => {
        salonRow = { currency: "INR", language: "en" };
        await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate("s1", "payment_received");
        const p = lastInsert();
        expect(p[3]).toBe("en");
        expect(p[5]).toBe(
            "Hi {{customer_name}},\nYour bill of ₹{{amount}} at {{salon_name}} has been successfully paid.\nAppointment: {{appointment_date}}\nTime: {{appointment_time}}\nThank you for choosing {{salon_name}} — we appreciate you!",
        );
    });

    it("Arabic salon: WhatsApp copy is Arabic, submitted as language 'ar', with the AED sign filled in", async () => {
        salonRow = { currency: "AED", language: "ar" };
        await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate("s1", "payment_received");
        const p = lastInsert();
        expect(p[3]).toBe("ar");
        expect(p[5]).toContain("AED {{amount}}");
        expect(p[5]).toContain("سداد");
    });

    it("Hindi salon: email subject and body are Hindi; SMS keeps the ASCII currency label", async () => {
        salonRow = { currency: "INR", language: "hi" };
        await notificationChannelsRepository.findOrSeedTemplate("s1", "payment_received", "EMAIL");
        let p = lastInsert(); // salon, event, channel, enabled, subject, body
        expect(p[4]).toBe("आपके अपॉइंटमेंट की रसीद — {{salon_name}}");
        expect(p[5]).toContain("Rs.{{amount}}");
        calls.length = 0;
        await notificationChannelsRepository.findOrSeedTemplate("s1", "payment_received", "SMS");
        p = lastInsert();
        expect(p[5]).toContain("Rs.{{amount}}");
    });

    it("a language with no wording falls back to the English default", async () => {
        salonRow = { currency: "INR", language: "fr" };
        await notificationChannelsRepository.findOrSeedTemplate("s1", "appointment_cancelled", "EMAIL");
        expect(lastInsert()[4]).toBe("Your Appointment has been Cancelled — {{salon_name}}");
    });
});
