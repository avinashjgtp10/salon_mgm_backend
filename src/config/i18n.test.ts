// The backend translator and its dictionaries: fallback behaviour, placeholder filling, and a parity guard so Hindi and
// Arabic cannot lose a key (or a {{placeholder}}) that English has — a receipt with a hole in it is worse than English.
import en from "../locales/en.json";
import hi from "../locales/hi.json";
import ar from "../locales/ar.json";
import { translator, translationFor } from "./i18n";
import { DEFAULT_PURCHASE_TEMPLATES } from "../modules/whatsapp-automation/wa-automation-defaults";
import { DEFAULT_SMS_TEMPLATES, DEFAULT_EMAIL_TEMPLATES } from "../modules/notification-channels/notification-channels-defaults";
import { normalizeLanguage, languageDir, languageDateLocale, isSupportedLanguage, LANGUAGES } from "./language";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
    for (const [k, v] of Object.entries(tree)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") out[key] = v;
        else flatten(v, key, out);
    }
    return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe("translator", () => {
    it("answers in the requested language", () => {
        expect(translator("en")("receipt.grandTotal")).toBe("Grand Total");
        expect(translator("hi")("receipt.grandTotal")).toBe("कुल योग");
        expect(translator("ar")("receipt.grandTotal")).toBe("الإجمالي الكلي");
    });

    it("treats unknown, blank and regional codes sensibly", () => {
        expect(translator(undefined)("receipt.total")).toBe("TOTAL");
        expect(translator("xx")("receipt.total")).toBe("TOTAL");
        expect(translator("ar-AE")("receipt.total")).toBe(translator("ar")("receipt.total"));
    });

    it("fills placeholders and leaves unknown ones visible", () => {
        expect(translator("en")("receipt.couponWith", { code: "SAVE10" })).toBe("Coupon (SAVE10)");
        expect(translator("ar")("receipt.paidVia", { method: "نقدًا" })).toContain("نقدًا");
        expect(translator("en")("receipt.couponWith")).toBe("Coupon ({{code}})");
    });

    it("returns the key itself when nothing has it, never a blank", () => {
        expect(translator("hi")("receipt.doesNotExist")).toBe("receipt.doesNotExist");
    });
});

describe("languages", () => {
    it("knows direction and date locale", () => {
        expect(normalizeLanguage("AR-ae")).toBe("ar");
        expect(languageDir("ar")).toBe("rtl");
        expect(languageDir("hi")).toBe("ltr");
        expect(languageDir(undefined)).toBe("ltr");
        expect(languageDateLocale("ar")).toBe("ar-AE");
        expect(languageDateLocale("en")).toBeUndefined();
    });
    it("validates codes", () => {
        expect(isSupportedLanguage("hi")).toBe(true);
        expect(isSupportedLanguage("fr")).toBe(false);
        expect(isSupportedLanguage(undefined)).toBe(false);
    });
    it("has a dictionary for every language listed", () => {
        const have = new Set(["en", "hi", "ar"]);
        expect(Object.keys(LANGUAGES).every((c) => have.has(c))).toBe(true);
    });
});

describe("dictionary parity", () => {
    const english = flatten(en as Tree);
    for (const [code, tree] of [["hi", hi], ["ar", ar]] as const) {
        const dict = flatten(tree as Tree);
        it(`${code} has every English key, none empty, with the same placeholders`, () => {
            const missing = Object.keys(english).filter((k) => !(k in dict));
            const empty = Object.entries(dict).filter(([, v]) => !v.trim()).map(([k]) => k);
            const badPlaceholders = Object.entries(english).filter(([k, v]) => k in dict && placeholders(dict[k]).join() !== placeholders(v).join()).map(([k]) => k);
            expect({ missing, empty, badPlaceholders }).toEqual({ missing: [], empty: [], badPlaceholders: [] });
        });
    }
});

// The customer messages a salon is seeded with. English lives in code (approved Meta templates must stay byte-identical),
// so Hindi and Arabic are checked against those originals: every event, every channel, the same {{placeholders}} and
// currency marker. A dropped placeholder sends a customer a message with a hole in it; a changed one fails Meta's check.
describe("seeded customer messages", () => {
    const events = Object.keys(DEFAULT_PURCHASE_TEMPLATES) as Array<keyof typeof DEFAULT_PURCHASE_TEMPLATES>;
    const english: Record<string, (e: (typeof events)[number]) => string> = {
        wa: (e) => DEFAULT_PURCHASE_TEMPLATES[e].bodyText,
        sms: (e) => DEFAULT_SMS_TEMPLATES[e],
        emailSubject: (e) => DEFAULT_EMAIL_TEMPLATES[e].subject,
        emailBody: (e) => DEFAULT_EMAIL_TEMPLATES[e].body,
    };
    const uniq = (s: string) => [...new Set(placeholders(s))];
    const startsOrEndsWithVariable = (s: string) => /^\s*\{\{/.test(s) || /\}\}\s*$/.test(s);

    it("English stays in code, not copied into the dictionary", () => {
        expect(translationFor("en", "messages.wa.client_welcome")).toBeUndefined();
    });

    for (const lang of ["hi", "ar"]) {
        it(`${lang} covers every event on every channel with the same placeholders`, () => {
            const problems: string[] = [];
            for (const event of events) {
                for (const [kind, getEnglish] of Object.entries(english)) {
                    const translated = translationFor(lang, `messages.${kind}.${event}`);
                    const original = getEnglish(event);
                    if (!translated) { problems.push(`${kind}.${event}: missing`); continue; }
                    if (uniq(translated).sort().join() !== uniq(original).sort().join()) problems.push(`${kind}.${event}: placeholders`);
                    if ((translated.match(/¤/g) ?? []).length !== (original.match(/¤/g) ?? []).length) problems.push(`${kind}.${event}: currency marker`);
                    // Meta rejects a WhatsApp body that starts or ends with a variable.
                    if (kind === "wa" && startsOrEndsWithVariable(translated) && !startsOrEndsWithVariable(original)) problems.push(`${kind}.${event}: starts/ends with a variable`);
                }
            }
            expect(problems).toEqual([]);
        });
    }
});

describe("channel email envelope", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { renderChannelEmailHtml } = require("../modules/notification-channels/notification-channels.render");
    it("mirrors for Arabic and keeps English left-to-right", () => {
        const ar = renderChannelEmailHtml({ subject: "s", bodyText: "b", salonName: "Glow", language: "ar" });
        expect(ar).toContain('lang="ar" dir="rtl"');
        expect(ar).toContain("إشعار تلقائي");
        const en = renderChannelEmailHtml({ subject: "s", bodyText: "b", salonName: "Glow" });
        expect(en).toContain('lang="en" dir="ltr"');
        expect(en).toContain("Automated notification.");
    });
});
