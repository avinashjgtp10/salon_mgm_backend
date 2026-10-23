import config from "../../config/env";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { staffHasPermission } from "../../middleware/permission.middleware";
import { salonsRepository } from "../salons/salons.repository";
import { aiAssistantRepository } from "./ai-assistant.repository";
import { retrieveKnowledge } from "./knowledge";
import { llmClient } from "./llm.client";
import { buildScopedRules } from "./rules";
import { requireSalonAiCredentials } from "../ai-credentials/ai-credentials.service";
import { assistantTools, findTool } from "./tools";
import { AssistantUser, ChatRequestBody, ChatResult, LlmMessage } from "./ai-assistant.types";

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_LIMIT = 10;
const MAX_TOOL_RESULT_CHARS = 6000;
const FALLBACK_REPLY = "I couldn't get an answer just now. Please try again in a moment, or contact SalonOx support.";

function buildSystemPrompt(salonName: string, knowledge: Array<{ title: string; text: string }>): string {
    const NL = "\n";
    const kb = knowledge.length
        ? `${NL}${NL}SalonOx information relevant to this question — this is the ONLY source of truth for how SalonOx works:${NL}${knowledge.map((k, i) => `[${i + 1}] ${k.title}: ${k.text}`).join(NL)}`
        : `${NL}${NL}No SalonOx information matched this question. Do not describe how SalonOx works from memory; use the reply for unverified information.`;
    return `You are LUNOX, the AI assistant built into SalonOx, helping the manager of "${salonName}" use the SalonOx salon management software and understand their business.

${buildScopedRules()}

Tools: for anything about this salon's own data (services, prices, products, stock, staff, today's appointments) call a tool — never guess or invent numbers, names or prices. Use only the tools you have.${kb}`;
}

export async function assertWithinLimits(user: AssistantUser) {
    // LUNOX is switched on per salon by Super Admin saving that salon's Cloudflare key; without it, stop before any work.
    await requireSalonAiCredentials(user.salonId);
    try {
        const [perMinute, monthTokens] = await Promise.all([
            aiAssistantRepository.requestsInLastMinute(user.userId),
            aiAssistantRepository.tokensThisMonth(user.salonId),
        ]);
        if (perMinute >= config.aiAssistant.requestsPerMinutePerUser) {
            throw new AppError(429, "Too many requests. Please wait a moment.", "RATE_LIMITED");
        }
        if (monthTokens >= config.aiAssistant.monthlyTokenCapPerSalon) {
            throw new AppError(429, "This salon's monthly AI usage limit has been reached.", "AI_QUOTA_EXCEEDED");
        }
    } catch (err) {
        if (err instanceof AppError) throw err;
        // Usage table missing (migration not yet run) must not take the assistant down — but say so loudly.
        logger.warn("[ai-assistant] usage limit check skipped", { error: (err as any)?.message });
    }
}

export async function userCanUse(user: AssistantUser, permission?: string | string[]): Promise<boolean> {
    if (!permission) return true;
    if (user.role === "salon_owner" || user.role === "admin") return true;
    if (user.role !== "staff") return false;
    for (const key of Array.isArray(permission) ? permission : [permission]) {
        if (await staffHasPermission(user, key)) return true;
    }
    return false;
}

export const aiAssistantService = {
    async chat(user: AssistantUser, body: ChatRequestBody): Promise<ChatResult> {
        await assertWithinLimits(user);

        const salon = await salonsRepository.findById(user.salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const knowledge = await retrieveKnowledge(body.message);
        const history = (body.history ?? [])
            .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
            .slice(-HISTORY_LIMIT)
            .map((t) => ({ role: t.role, content: t.content.slice(0, 2000) }));

        const messages: LlmMessage[] = [
            { role: "system", content: buildSystemPrompt(salon.business_name, knowledge) },
            ...history,
            { role: "user", content: body.message },
        ];
        const toolsUsed: string[] = [];
        const sources = knowledge.map((k) => ({ id: k.id, title: k.title }));

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
            let response: LlmMessage;
            try {
                response = await llmClient.chat({ messages, tools: assistantTools, salonId: user.salonId, userId: user.userId });
            } catch (err: any) {
                logger.error("[ai-assistant] LLM unavailable", { error: err?.message });
                return { reply: FALLBACK_REPLY, sources: [], toolsUsed };
            }

            if (!response.tool_calls?.length) {
                return { reply: response.content?.trim() || FALLBACK_REPLY, sources, toolsUsed };
            }

            messages.push(response);
            for (const call of response.tool_calls) {
                let args: Record<string, any> = {};
                try {
                    const parsed = JSON.parse(call.function.arguments || "{}");
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
                } catch {
                    // malformed args — the tool validates its own input
                }

                const tool = findTool(call.function.name);
                let result: unknown;
                if (!tool) {
                    result = { error: `Unknown tool: ${call.function.name}` };
                } else if (!(await userCanUse(user, tool.permission))) {
                    result = { error: "The signed-in user does not have permission to view this data." };
                } else {
                    try {
                        result = await tool.execute(args, user);
                        toolsUsed.push(tool.name);
                    } catch (err: any) {
                        logger.error("[ai-assistant] tool failed", { tool: tool.name, error: err?.message });
                        result = { error: err instanceof AppError ? err.message : "This data is temporarily unavailable." };
                    }
                }

                messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    name: call.function.name,
                    content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS),
                });
            }
        }

        logger.warn("[ai-assistant] tool loop exceeded max iterations", { userId: user.userId, toolsUsed });
        return { reply: FALLBACK_REPLY, sources, toolsUsed };
    },
};
