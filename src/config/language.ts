import pool from "./database";

// ═══════════════════════════════════════════════════════════════════════════════
// The languages SalonOX can speak, and each salon's own (salons.language).
//
// Adding a language: add it to LANGUAGES here, add the frontend dictionary (src/locales/<code>/translation.json in the
// frontend repo + config/languages.ts there) and the backend dictionary (src/locales/<code>.ts). Anything not yet
// translated falls back to English — a gap never shows a blank or a raw key.
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_LANGUAGE = "en";

interface LanguageDef {
    /** Name in its own script, for pickers. */
    nativeName: string;
    /** Writing direction — right-to-left languages need the document mirrored. */
    dir: "ltr" | "rtl";
    /** Locale for dates and clock times when this language is shown (month names in the language). */
    dateLocale?: string;
}

export const LANGUAGES: Record<string, LanguageDef> = {
    en: { nativeName: "English", dir: "ltr" },
    hi: { nativeName: "हिन्दी", dir: "ltr", dateLocale: "hi-IN" },
    ar: { nativeName: "العربية", dir: "rtl", dateLocale: "ar-AE" },
    zh: { nativeName: "简体中文", dir: "ltr", dateLocale: "zh-CN" },
    ko: { nativeName: "한국어", dir: "ltr", dateLocale: "ko-KR" },
    ja: { nativeName: "日本語", dir: "ltr", dateLocale: "ja-JP" },
    th: { nativeName: "ไทย", dir: "ltr", dateLocale: "th-TH-u-ca-gregory" },
    id: { nativeName: "Bahasa Indonesia", dir: "ltr", dateLocale: "id-ID" },
    vi: { nativeName: "Tiếng Việt", dir: "ltr", dateLocale: "vi-VN" },
    ms: { nativeName: "Bahasa Melayu", dir: "ltr", dateLocale: "ms-MY" },
};

export const SUPPORTED_LANGUAGE_CODES = Object.keys(LANGUAGES);

/** A supported language code, or the default for anything else (blank, unknown, a regional tag like "ar-AE"). */
export function normalizeLanguage(code: string | null | undefined): string {
    const base = String(code ?? "").trim().toLowerCase().split(/[-_]/)[0];
    return LANGUAGES[base] ? base : DEFAULT_LANGUAGE;
}

export function isSupportedLanguage(code: unknown): code is string {
    return typeof code === "string" && !!LANGUAGES[code];
}

export function languageDir(code?: string | null): "ltr" | "rtl" {
    return LANGUAGES[normalizeLanguage(code)].dir;
}

/** Locale for dates in this language, or undefined when the language has none of its own (use the currency's). */
export function languageDateLocale(code?: string | null): string | undefined {
    return LANGUAGES[normalizeLanguage(code)].dateLocale;
}

// ── Per-salon lookup ───────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
const salonCache = new Map<string, { language: string; at: number }>();

/**
 * A salon's language (salons.language), cached briefly. Never throws: any problem — including the column not
 * existing yet because Migration/add_salon_language.sql has not been run — falls back to the default.
 */
export async function getSalonLanguage(salonId: string | null | undefined): Promise<string> {
    if (!salonId) return DEFAULT_LANGUAGE;
    const hit = salonCache.get(salonId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.language;
    let language = DEFAULT_LANGUAGE;
    try {
        const { rows } = await pool.query(`SELECT to_jsonb(s) ->> 'language' AS language FROM salons s WHERE s.id = $1`, [salonId]);
        language = normalizeLanguage(rows[0]?.language);
    } catch {
        // fall through to the default
    }
    salonCache.set(salonId, { language, at: Date.now() });
    return language;
}

/** Call after a salon's language is changed so the next message uses it immediately. */
export function invalidateSalonLanguage(salonId: string): void {
    salonCache.delete(salonId);
}
