import logger from "../../../config/logger";
import redis from "../../../config/redis";
import { AppError } from "../../../middleware/error.middleware";
import { salonsRepository } from "../../salons/salons.repository";
import { AssistantUser } from "../ai-assistant.types";
import { dataAssistantService } from "./data-assistant.service";
import { todayIn } from "./periods";

// Dashboard "AI insight" card: one short, data-backed tip per day. Built by the same read-only data assistant as
// "Ask your data" (real tool numbers only, each tool checks the caller's own permissions) and cached for the day so a
// salon pays for one AI call per day, not one per dashboard open.

export type DailyInsight = { text: string; date: string } | null;

const TTL_SECONDS = 26 * 60 * 60; // a little over a day, so the key outlives the salon's local midnight
const REDIS_TIMEOUT_MS = 1500;
const MAX_CHARS = 400;

export const DAILY_INSIGHT_QUESTION =
    "Give me ONE short insight for today about my salon, in one or two sentences (at most 35 words). " +
    "Pick the single most useful thing I can act on, using real numbers from your tools: for example clients I haven't seen for a while, " +
    "how this week compares with last week, or a service that is selling less than usual. " +
    "Plain sentences only: no table, no list, no heading, no greeting.";

// Replies the assistant gives when it couldn't produce a real answer; never cache or show these as an insight.
const NOT_AN_INSIGHT = [/couldn'?t get (that|an) answer/i, /can'?t help with that/i, /only (help|answer)/i];

/** Owners/admins see every report, so they share the salon's insight; staff get their own (their tools may see less). */
export const insightCacheKey = (user: AssistantUser, date: string) =>
    `lunox:daily-insight:${user.salonId}:${date}:${user.role === "staff" ? `staff:${user.userId}` : "owner"}`;

/** Redis call that gives up quickly: a slow or down cache must never block the dashboard. */
async function withTimeout<T>(work: Promise<T>): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([work, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), REDIS_TIMEOUT_MS); })]);
    } catch (err: any) {
        logger.warn("[ai-assistant] daily insight cache unavailable", { error: err?.message });
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Plain text for a small card: drop Markdown marks and collapse to one paragraph. */
export function cleanInsight(reply: string): string | null {
    const text = reply
        .replace(/^\s*([-*•]|\d+[.)])\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/[#>*_`|]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!text || NOT_AN_INSIGHT.some((pattern) => pattern.test(text))) return null;
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1).trimEnd()}…` : text;
}

export const dailyInsightService = {
    async get(user: AssistantUser): Promise<DailyInsight> {
        const salon = await salonsRepository.findById(user.salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        const date = todayIn(salon.timezone || "Asia/Kolkata");
        const key = insightCacheKey(user, date);

        const cached = await withTimeout(redis.get(key));
        if (cached) return { text: cached, date };

        let reply: string;
        try {
            reply = (await dataAssistantService.ask(user, { message: DAILY_INSIGHT_QUESTION, history: [] })).reply;
        } catch (err: any) {
            // LUNOX not switched on for this salon, or a usage limit: the dashboard just hides the card.
            if (err instanceof AppError && ["MODULE_LOCKED", "RATE_LIMITED", "AI_QUOTA_EXCEEDED"].includes(String(err.code))) return null;
            throw err;
        }

        const text = cleanInsight(reply);
        if (!text) return null;
        await withTimeout(redis.set(key, text, "EX", TTL_SECONDS));
        return { text, date };
    },
};
