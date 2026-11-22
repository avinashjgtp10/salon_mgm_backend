import { normalizeCountryCode } from "./salonTimezone";

// Phone numbers are stored as a plain national number + a separate dial code, and the length rule follows
// that DIAL CODE (not a hardcoded country): India is exactly 10 digits, a UAE mobile 9 (often typed with a
// leading 0 or the +971 prefix, which are dropped), China 11, and so on - see NATIONAL_LENGTHS.
// Dial codes missing from the table fall back to the E.164 envelope (6-15 digits).
// Mirrors the frontend's src/config/phoneRules.ts - keep the two (and the table) in step.
export interface PhoneRule {
    dialCode: string;
    minLength: number;
    nationalLength: number; // the maximum; equals minLength for fixed-length countries
    label: string; // how the rule is described in error messages
}

// dial code (no "+") -> "n" for a fixed length, "min-max" for a range. National significant number, no trunk 0.
const NATIONAL_LENGTHS =
    "93:9,355:8-9,213:9,244:9,54:10-11,374:8,61:9,43:10-13,994:9,973:8,880:10,375:9,32:8-9,591:8,387:8-9,55:10-11,359:8-9,855:8-9,237:9,1:10,56:9,86:11,57:10,385:8-9,53:8,357:8,420:9,45:8,593:9,20:10,372:7-8,251:9,358:9-10,33:9,995:9,49:10-11,233:9,30:10,502:8,852:8,36:9,354:7,91:10,62:9-12,98:10,964:10,353:9,972:9,39:9-10,81:10,962:9,7:10,254:9,965:8,996:9,371:8,961:7-8,218:9,370:8,352:8-9,60:9-10,960:7,52:10,373:8,976:8,212:9,258:9,95:8-10,977:10,31:9,64:8-10,234:10,47:8,968:8,92:10,970:9,507:8,51:9,63:10,48:9,351:9,974:8,40:9,966:9,381:8-9,65:8,421:9,386:8,252:8-9,27:9,82:9-10,34:9,94:9,249:9,46:7-10,41:9,963:9,886:9,992:9,255:9,66:9,216:8,90:10,993:8,256:9,380:9,971:9,44:10,598:8,998:9,58:10,84:9-10,967:9,260:9,263:9";

const TABLE = new Map<string, [number, number]>();
for (const entry of NATIONAL_LENGTHS.split(",")) {
    const [code, len] = entry.split(":");
    const [min, max] = len.split("-").map(Number);
    TABLE.set(code, [min, max ?? min]);
}

const INDIA: PhoneRule = { dialCode: "+91", minLength: 10, nationalLength: 10, label: "10-digit" };
const UAE: PhoneRule = { dialCode: "+971", minLength: 9, nationalLength: 9, label: "9-digit UAE" };


export function phoneRuleForDialCode(dialCode: string | null | undefined): PhoneRule {
    const code = String(dialCode ?? "").replace(/[^0-9]/g, "");
    if (!code || code === "91") return INDIA; // no dial code on the record = legacy Indian client
    if (code === "971") return UAE;
    const hit = TABLE.get(code);
    const [min, max] = hit ?? [6, 15];
    const label = min === max ? `${max}-digit` : `${min}-${max} digit`;
    return { dialCode: `+${code}`, minLength: min, nationalLength: max, label: hit ? `${label} +${code}` : label };
}

// Salon-level default (enquiries, imports): the salon's country decides the dial code. Countries outside
// the two we map keep India's rule, as before.
export function phoneRuleFor(country: string | null | undefined): PhoneRule {
    return normalizeCountryCode(country) === "AE" ? UAE : INDIA;
}

export function dialCodeFor(country: string | null | undefined): string {
    return phoneRuleFor(country).dialCode;
}

function normalizeWithRule(raw: unknown, rule: PhoneRule): string {
    // India: only spreadsheet-style separators are tolerated (anything else, e.g. a letter, stays and fails the
    // digits-only check) - exactly what this app has always accepted.
    if (rule === INDIA) return String(raw ?? "").replace(/[() .-]/g, "");
    let digits = String(raw ?? "").replace(/[^0-9]/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    const code = rule.dialCode.slice(1);
    if (digits.startsWith(code) && digits.length > rule.nationalLength) digits = digits.slice(code.length);
    if (digits.startsWith("0") && (rule === UAE || digits.length > rule.nationalLength)) digits = digits.slice(1);
    return digits;
}

function validWithRule(raw: unknown, rule: PhoneRule): boolean {
    const digits = normalizeWithRule(raw, rule);
    return digits.length >= rule.minLength && digits.length <= rule.nationalLength && /^[0-9]+$/.test(digits);
}

// Salon-country flavours (enquiries / import) ...
export function normalizeNationalNumber(raw: unknown, country: string | null | undefined): string {
    return normalizeWithRule(raw, phoneRuleFor(country));
}
export function isValidNationalNumber(raw: unknown, country: string | null | undefined): boolean {
    return validWithRule(raw, phoneRuleFor(country));
}
export function nationalNumberError(country: string | null | undefined): string {
    return `A valid ${phoneRuleFor(country).label} phone number is required`;
}

// ... and dial-code flavours (a client's own country selection).
export function normalizeNationalNumberForDial(raw: unknown, dialCode: string | null | undefined): string {
    return normalizeWithRule(raw, phoneRuleForDialCode(dialCode));
}
export function isValidNationalNumberForDial(raw: unknown, dialCode: string | null | undefined): boolean {
    return validWithRule(raw, phoneRuleForDialCode(dialCode));
}
export function nationalNumberErrorForDial(dialCode: string | null | undefined): string {
    return `A valid ${phoneRuleForDialCode(dialCode).label} phone number is required`;
}
