// Guard for "currency has exactly one entry point" (src/config/currency.ts).
//
// Fails if any source file outside that module (and the few documented exceptions below) contains
//   - a currency sign or abbreviation: "₹", "Rs."
//   - a quoted ISO-code default: "INR" / 'INR' / `INR`
//   - a hand-rolled currency formatter: Intl.NumberFormat with style "currency"
//   - the Indian locale "en-IN" (dates and times go through dateLocale() / getSalonDateLocale())
// Comments are ignored. To print an amount, use formatMoney / formatSalonMoney / getSalonMoneyFormatter /
// formatMoneyAscii; for message-template wording use the ¤ marker (applyCurrencyMarker).

import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "..");

// The entry point itself.
const ENTRY_POINT = "config/currency.ts";

// Deliberate exceptions, each with the reason it is not a salon-currency concern.
const EXEMPT: { prefix: string; why: string }[] = [
    { prefix: "modules/subscription-upgrade/", why: "SaaS subscription billing — the platform's price list is denominated in PLATFORM_BILLING_CURRENCY (SQL/DB literals)" },
    { prefix: "modules/subscription-pricing/", why: "SaaS subscription billing — INR base price list, FX conversion, country→currency data table" },
    { prefix: "modules/subscription-invoices/", why: "SaaS subscription invoices (SQL currency columns)" },
    { prefix: "modules/subscriptions/", why: "SaaS subscription checkout / plan changes" },
    { prefix: "modules/plan-pricing/", why: "SaaS plan price list and its Razorpay plan registry (SQL)" },
    { prefix: "modules/payment-tracking/", why: "SaaS subscription payment tracking (SQL)" },
    { prefix: "modules/super-admin/", why: "Platform administration screens" },
    { prefix: "modules/pos-payments/providers/paytm.helpers.ts", why: "Paytm EDC settles in INR only — a capability of that provider (PAYTM_CURRENCY)" },
];

const FORBIDDEN: { re: RegExp; what: string }[] = [
    { re: /₹/, what: 'the rupee sign "₹"' },
    { re: /\bRs\./, what: 'the abbreviation "Rs."' },
    { re: /["'`]INR["'`]/, what: 'a quoted "INR" default/comparison' },
    { re: /style:\s*["']currency["']/, what: "a hand-rolled Intl currency formatter" },
    { re: /["'`]en-IN["'`]/, what: 'the Indian locale "en-IN" (use dateLocale() / getSalonDateLocale() for dates and times, numberLocale() for numbers)' },
];

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === "__mocks__") continue;
            walk(p, out);
        } else if (/\.ts$/.test(e.name) && !/\.(test|spec|d)\.ts$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

// Removes /* … */ blocks, // line comments and whole-line SQL "--" comments, keeping line numbers intact.
function stripComments(src: string): string {
    let out = "";
    let i = 0;
    let inBlock = false;
    while (i < src.length) {
        if (inBlock) {
            if (src[i] === "*" && src[i + 1] === "/") { inBlock = false; i += 2; continue; }
            out += src[i] === "\n" ? "\n" : " ";
            i++;
            continue;
        }
        if (src[i] === "/" && src[i + 1] === "*") { inBlock = true; i += 2; continue; }
        if (src[i] === "/" && src[i + 1] === "/" && src[i - 1] !== ":") {
            while (i < src.length && src[i] !== "\n") i++;
            continue;
        }
        out += src[i];
        i++;
    }
    return out
        .split("\n")
        .map((line) => (/^\s*--/.test(line) ? "" : line))
        .join("\n");
}

describe("currency has exactly one entry point", () => {
    const files = walk(SRC)
        .map((f) => ({ abs: f, rel: path.relative(SRC, f).split(path.sep).join("/") }))
        .filter((f) => f.rel !== ENTRY_POINT && !EXEMPT.some((x) => f.rel.startsWith(x.prefix)));

    it("scans a sensible number of files", () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it("no file outside the entry point hardcodes a currency", () => {
        const offences: string[] = [];
        for (const f of files) {
            const lines = stripComments(fs.readFileSync(f.abs, "utf8")).split("\n");
            lines.forEach((line, idx) => {
                for (const rule of FORBIDDEN) {
                    if (rule.re.test(line)) offences.push(`${f.rel}:${idx + 1}  ${rule.what}  →  ${line.trim().slice(0, 110)}`);
                }
            });
        }
        if (offences.length) {
            throw new Error(
                `Currency must come from src/config/currency.ts (formatMoney / formatSalonMoney / getSalonMoneyFormatter / ` +
                `formatMoneyAscii / applyCurrencyMarker). Hardcoded currency found:\n  ${offences.join("\n  ")}`,
            );
        }
    });

    it("every exemption still exists (so the list can't silently rot)", () => {
        for (const x of EXEMPT) {
            const target = path.join(SRC, x.prefix);
            expect(fs.existsSync(target)).toBe(true);
        }
    });
});
