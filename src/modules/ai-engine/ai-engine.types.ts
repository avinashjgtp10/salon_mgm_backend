// ─── Agent context ───────────────────────────────────────────────────────────
// Injected by the service layer for every tool call — never derived from model output.
export type AgentContext = {
    salonId: string;
    clientId: string | null;
    phone: string;
    customerName: string | null;
};

// ─── Tool interface ──────────────────────────────────────────────────────────
export type JsonSchema = {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
};

export type Tool = {
    name: string;
    description: string;
    parameters: JsonSchema;
    execute: (args: Record<string, any>, ctx: AgentContext) => Promise<unknown>;
};

// ─── Groq chat-completions wire types (subset, OpenAI-compatible) ────────────
export type GroqChatRole = "system" | "user" | "assistant" | "tool";

export type GroqToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
};

export type GroqMessage = {
    role: GroqChatRole;
    content: string | null;
    tool_calls?: GroqToolCall[];
    tool_call_id?: string;
    name?: string;
};

export type GroqChatCompletionResponse = {
    choices: Array<{
        message: GroqMessage;
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
};

// ─── Memory ──────────────────────────────────────────────────────────────────
export type AiCustomerMemory = {
    id: string;
    salon_id: string;
    client_id: string | null;
    phone: string;
    preferred_staff_id: string | null;
    preferred_language: string | null;
    notes: string | null;
    birthday: string | null;
    created_at: string;
    updated_at: string;
};

export type AiAgentLog = {
    id: string;
    salon_id: string;
    phone: string;
    user_message: string;
    tool_calls: unknown;
    assistant_reply: string;
    latency_ms: number;
    created_at: string;
};

// ─── Chat endpoint (debug) ────────────────────────────────────────────────────
export type ChatRequestBody = {
    phone: string;
    message: string;
};

export type ChatResult = {
    reply: string;
    toolCalls: Array<{ name: string; args: Record<string, any>; result: unknown }>;
};
