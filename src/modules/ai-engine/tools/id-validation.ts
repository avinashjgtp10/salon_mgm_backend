import { AppError } from "../../../middleware/error.middleware";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Conversation history between turns is plain text only (no retained tool-call
// results), so the model sometimes guesses an id from a name it saw earlier
// (e.g. staff_id: "ram") instead of re-resolving it. A raw DB error from that
// gets masked as a generic failure; this throws an AppError instead, whose
// message passes through to the model verbatim so it can self-correct by
// calling the right lookup tool again rather than escalating to a human.
export function requireUuid(value: unknown, fieldName: string, lookupTool: string): string {
    if (typeof value !== "string" || !UUID_RE.test(value)) {
        throw new AppError(
            400,
            `"${value}" is not a valid ${fieldName} — it must be a real id from ${lookupTool}, not a name. Call ${lookupTool} again to get the correct id.`,
            "INVALID_ID"
        );
    }
    return value;
}

// The model resolves relative dates ("today", "tomorrow") itself from the
// current-time hint in the system prompt, but nothing stops it from booking a
// date/time that's already elapsed (its own miscalculation, a stale date
// carried over from earlier in the conversation, etc). A booked appointment
// with a past scheduled_at is silently wrong, not just cosmetically odd.
export function requireFutureDateTime(scheduledAtIso: string): void {
    if (new Date(scheduledAtIso).getTime() <= Date.now()) {
        throw new AppError(
            400,
            "That date and time has already passed. Ask the customer for a future date/time — never book or suggest a slot that's already elapsed.",
            "PAST_DATETIME"
        );
    }
}
