import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { getSalonTimezone, salonWallClockNow } from "../../config/salonTimezone";
import { getSalonLanguage, LANGUAGES } from "../../config/language";
import { writeTemplateCopy } from "../ai-assistant/marketing-ai.service";
import type { AssistantUser } from "../ai-assistant/ai-assistant.types";
import { Festival, upcomingFestivals } from "./festival.calendar";

export interface SalonFestivalContext {
    country: string | null;
    state: string | null;
    tz: string;
    /** The salon's own calendar day, YYYY-MM-DD. */
    today: string;
}

/** Country, state and time zone from the salon's own settings. Never throws: a lookup failure reads as India defaults. */
export async function salonFestivalContext(salonId: string): Promise<SalonFestivalContext> {
    let country: string | null = null;
    let state: string | null = null;
    try {
        const { rows } = await pool.query(`SELECT country, state FROM salons WHERE id = $1`, [salonId]);
        country = rows[0]?.country ?? null;
        state = rows[0]?.state ?? null;
    } catch {
        /* defaults */
    }
    const tz = await getSalonTimezone(salonId);
    const now = salonWallClockNow(tz);
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    return { country, state, tz, today };
}

export async function upcomingForSalon(salonId: string, daysAhead = 90): Promise<Festival[]> {
    const ctx = await salonFestivalContext(salonId);
    return upcomingFestivals({ country: ctx.country, state: ctx.state, today: ctx.today, daysAhead });
}

const prettyDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Three WhatsApp message drafts for one upcoming festival. Drafts only: nothing is sent, the owner reviews them and launches a
 * campaign themselves.
 */
export async function festivalMessageDrafts(user: AssistantUser, key: string): Promise<{ festival: Festival; variants: string[] }> {
    const festival = (await upcomingForSalon(user.salonId, 400)).find((f) => f.key === key);
    if (!festival) throw new AppError(404, "That festival is not coming up for your salon.", "NOT_FOUND");
    const lang = await getSalonLanguage(user.salonId);
    const brief = `${festival.name} is on ${prettyDate(festival.date)}. Invite our clients to book early for a festive service offer. Do not state any price or discount; say "a special festive offer".`;
    const { variants } = await writeTemplateCopy(user, {
        brief,
        tone: "festive",
        language: lang === "en" ? "English" : (LANGUAGES[lang]?.nativeName ?? "English"),
        category: "MARKETING",
    });
    return { festival, variants };
}
