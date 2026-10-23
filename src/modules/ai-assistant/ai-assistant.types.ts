export type AssistantUser = { userId: string; role?: string; salonId: string };

export type JsonSchema = {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
};

export type Tool = {
    name: string;
    description: string;
    parameters: JsonSchema;
    // Permission key(s) the caller must hold (any one of an array); omitted = any signed-in salon user.
    permission?: string | string[];
    execute: (args: Record<string, any>, user: AssistantUser) => Promise<unknown>;
};

export type LlmToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

export type LlmMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: LlmToolCall[];
    tool_call_id?: string;
    name?: string;
};

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatRequestBody = { message: string; history?: ChatTurn[] };

export type ChatResult = {
    reply: string;
    sources: Array<{ id: string; title: string }>;
    toolsUsed: string[];
};
