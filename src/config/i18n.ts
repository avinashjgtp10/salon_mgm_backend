import { DEFAULT_LANGUAGE, getSalonLanguage, normalizeLanguage } from "./language";
import en from "../locales/en.json";
import hi from "../locales/hi.json";
import ar from "../locales/ar.json";
import zh from "../locales/zh.json";
import ko from "../locales/ko.json";
import ja from "../locales/ja.json";
import th from "../locales/th.json";
import id from "../locales/id.json";
import vi from "../locales/vi.json";
import ms from "../locales/ms.json";

// ═══════════════════════════════════════════════════════════════════════════════
// Translated wording for everything the backend writes for a person: receipts and invoices, and (as they are moved
// over) emails and messages. The language comes from the salon (salons.language, see ./language.ts), never from the
// server.
//
// Dictionaries are src/locales/<code>.json, nested objects addressed by dotted keys ("receipt.grandTotal").
// A key missing in a language falls back to English, and a key missing everywhere comes back as the key itself — a
// gap is visible, never a blank. {{name}} placeholders are filled from `vars`.
// ═══════════════════════════════════════════════════════════════════════════════

type Dict = { [key: string]: string | Dict };

const DICTIONARIES: Record<string, Dict> = { en, hi, ar, zh, ko, ja, th, id, vi, ms };

export type Translator = (key: string, vars?: Record<string, string | number>) => string;

function lookup(dict: Dict | undefined, key: string): string | undefined {
    let node: string | Dict | undefined = dict;
    for (const part of key.split(".")) {
        if (node === undefined || typeof node === "string") return undefined;
        node = node[part];
    }
    return typeof node === "string" ? node : undefined;
}

function fill(text: string, vars?: Record<string, string | number>): string {
    if (!vars) return text;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * The wording a language has for a key, or undefined when it has none — no fallback to English. For choosing between
 * a translation and a default that lives in code (the message templates seeded for a salon).
 */
export function translationFor(code: string | null | undefined, key: string): string | undefined {
    return lookup(DICTIONARIES[normalizeLanguage(code)], key);
}

/** A translator for one language (a salon's `language` column, or anything — unknown codes mean English). */
export function translator(code?: string | null): Translator {
    const lang = normalizeLanguage(code);
    return (key, vars) =>
        fill(lookup(DICTIONARIES[lang], key) ?? lookup(DICTIONARIES[DEFAULT_LANGUAGE], key) ?? key, vars);
}

/**
 * A translator for a salon's own language (salons.language) — for text the backend writes on the salon's behalf: notifications and
 * e-mails. Never throws: a salon whose language cannot be read gets English.
 */
export async function salonTranslator(salonId: string | null | undefined): Promise<Translator> {
    return translator(await getSalonLanguage(salonId));
}
