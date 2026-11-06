export function hasProtocolContent(value: unknown): boolean {
    return typeof value === "string" && (
        /<\|(?:im_start|im_end|start|end|channel|message|call|return|constrain|meta_sep|meta_start|fim_suffix|ghissue|ghreview)[\s|>]/i.test(value) ||
        /(?:^|\n)\s*(?:analysis\s*(?:\n|$)|assistant\s+to=functions\.|to=functions\.)/i.test(value)
    );
}

export class InvalidLlmReplyError extends Error {
    constructor() { super("LLM returned protocol content instead of a final answer"); }
}
