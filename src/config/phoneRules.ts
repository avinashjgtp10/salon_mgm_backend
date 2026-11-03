import { normalizeCountryCode } from "./salonTimezone";

// Phone numbers are stored as a plain national number + a separate dial code. India's is exactly 10 digits
// (what this app has always assumed); a UAE mobile is 9 digits (5X XXX XXXX) and is often typed with a
// leading 0 or the +971 prefix, which are dropped. Countries we have no rule for keep India's, as before.
interface PhoneRule {
    dialCode: string;
    nationalLength: number;
    label: string; // how the rule is described in error messages
}

const INDIA: PhoneRule = { dialCode: "+91", nationalLength: 10, label: "10-digit" };
const UAE: PhoneRule = { dialCode: "+971", nationalLength: 9, label: "9-digit UAE" };

export function phoneRuleFor(country: string | null | undefined): PhoneRule {
    return normalizeCountryCode(country) === "AE" ? UAE : INDIA;
}

export function dialCodeFor(country: string | null | undefined): string {
    return phoneRuleFor(country).dialCode;
}

// Digits only, then (UAE) drop a 00 / 971 / leading-0 prefix so "+971 50 123 4567", "0501234567" and
// "501234567" all become "501234567". India: see the first line of the function.
export function normalizeNationalNumber(raw: unknown, country: string | null | undefined): string {
    // India: only spreadsheet-style separators are tolerated (anything else, e.g. a letter, stays and fails the
    // digits-only check below) - exactly what this app has always accepted.
    if (phoneRuleFor(country) === INDIA) return String(raw ?? "").replace(/[() .-]/g, "");
    let digits = String(raw ?? "").replace(/[^0-9]/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("971") && digits.length === 12) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits;
}

export function isValidNationalNumber(raw: unknown, country: string | null | undefined): boolean {
    const rule = phoneRuleFor(country);
    const digits = normalizeNationalNumber(raw, country);
    return digits.length === rule.nationalLength && /^[0-9]+$/.test(digits);
}

export function nationalNumberError(country: string | null | undefined): string {
    return `A valid ${phoneRuleFor(country).label} phone number is required`;
}
