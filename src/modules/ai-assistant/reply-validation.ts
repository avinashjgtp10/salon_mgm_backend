export function hasProtocolContent(value: unknown): boolean {
    return typeof value === "string" && (
        /<\|(?:im_start|im_end|start|end|channel|message|call|return|constrain|meta_sep|meta_start|fim_suffix|ghissue|ghreview)[\s|>]/i.test(value) ||
        /(?:^|\n)\s*(?:analysis\s*(?:\n|$)|assistant\s+to=functions\.|to=functions\.)/i.test(value)
    );
}

export class InvalidLlmReplyError extends Error {
    constructor() { super("LLM returned protocol content instead of a final answer"); }
}

// A model can get stuck repeating one character ("!!!!!!…") until it runs out of tokens. That is never an answer: it has no
// letters or digits, or is a long run made of one or two distinct characters.
export function isDegenerateReply(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const t = value.replace(/s+/g, "");
    if (t.length === 0) return false;
    if (!/[p{L}p{N}]/u.test(t)) return true;
    return t.length >= 30 && new Set(t).size <= 2;
}

// A count is never money. The prompt says so, but a model can still write "₹12 new clients"; this removes a currency sign (or code)
// stuck on a number that is directly followed by a counting word, and touches nothing else ("₹12,000 from clients" is left alone).
const COUNT_WITH_CURRENCY =
    /(?:₹|\$|€|£|(?:INR|AED|USD|EUR|GBP|Rs\.?)\s?)(\d[\d,]*)(\s+(?:(?:new|lost|returning|unique|total)\s+)?(?:clients?|customers?|bills?|invoices?|visits?|appointments?|bookings?|no-shows?|people|staff)\b)/gi;
export function stripCurrencyFromCounts(text: string): string {
    return text.replace(COUNT_WITH_CURRENCY, "$1$2");
}
