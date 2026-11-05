// A mistyped translation key does not throw — the translator returns the key itself, so the user would read "notify.yourTurn.titel"
// in an e-mail or push notification. This reads the source and checks that every email.* / notify.* key it asks for exists in all
// three dictionaries.
import fs from "fs";
import path from "path";
import { translationFor, translator } from "./i18n";

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".orig.ts")) out.push(p);
    }
    return out;
}

const SRC = path.join(__dirname, "..");
const KEY_CALL = /\b(?:t|nt)\(\s*["'`]((?:email|notify)\.[A-Za-z0-9_.-]+)["'`]/g;

// keys that are built with a template literal in the source, written out here
const DYNAMIC = [
    ...["checkedIn", "checkedOut"].flatMap((k) => [`notify.attendance.${k}.title`, `notify.attendance.${k}.body`]),
    ...["booked", "paid", "partial", "cancelled", "no-show", "deleted", "pending", "completed", "in_progress"].map((s) => `notify.status.${s}`),
];

describe("translation keys used by e-mails and notifications", () => {
    const used = new Map<string, string>();
    for (const file of walk(SRC)) {
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(KEY_CALL)) used.set(m[1], path.relative(SRC, file));
    }
    for (const k of DYNAMIC) used.set(k, "(built at run time)");

    it("finds the keys at all (guards the scan itself)", () => {
        expect(used.size).toBeGreaterThan(60);
    });

    it.each([...used])("%s exists in English, Hindi and Arabic", (key, file) => {
        for (const lang of ["en", "hi", "ar"]) {
            expect({ key, file, lang, text: translationFor(lang, key) }).toEqual({ key, file, lang, text: expect.any(String) });
        }
    });

    it("staff notification words keep English exactly as before", () => {
        const t = translator("en");
        expect(t("notify.status.no-show")).toBe("no-show");
        expect(t("notify.walkIn")).toBe("Walk-in");
        expect(t("notify.invoiceNotGenerated")).toBe("Invoice not generated");
        expect(t("notify.attendance.checkedIn.body", { name: "Ravi", clock: "10:00", day: "Mon" })).toBe("Ravi checked in at 10:00 on Mon.");
        expect(t("notify.appointmentLine", { client: "Meera", date: "04-03-2026", time: "10:30" })).toBe("Meera — 04-03-2026 at 10:30");
        expect(t("notify.inventory.expiringMany", { name: "Gel", date: "2026-04-01", days: 5 })).toBe("Gel expires on 2026-04-01 (5 days left).");
    });
});
