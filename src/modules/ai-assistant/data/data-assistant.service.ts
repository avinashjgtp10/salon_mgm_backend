import logger from "../../../config/logger";
import { OUT_OF_SCOPE_REPLY, SECURITY_RULES } from "../rules";
import { AppError } from "../../../middleware/error.middleware";
import { salonsRepository } from "../../salons/salons.repository";
import { assertWithinLimits, userCanUse } from "../ai-assistant.service";
import { llmClient } from "../llm.client";
import { AssistantUser, ChatTurn, LlmMessage } from "../ai-assistant.types";
import { dataTools, findDataTool } from "./data.tools";
import { todayIn } from "./periods";

const MAX_TOOL_ITERATIONS = 4;
const HISTORY_LIMIT = 6;
const MAX_TOOL_RESULT_CHARS = 5000;
const FALLBACK = "I couldn't get that answer just now. Please try again in a moment.";

function systemPrompt(salonName: string, tz: string): string {
    const today = todayIn(tz);
    const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
    return `You are LUNOX, the AI assistant built into SalonOx, answering questions about the numbers for the manager of "${salonName}". Today is ${weekday} ${today} (${tz}).
You answer questions about this salon's numbers: revenue, bills, top services/staff, payment methods, product sales, appointment counts and new clients.

Rules — never break these:
- Use ONLY numbers returned by your tools. Never estimate, guess or calculate figures yourself. Call a tool for every number.
- Pick the 'period' value that matches the question (e.g. "last month" → last_month). Never work out dates yourself; use period=custom only for exact dates the user gave.
- In your answer always say which dates you used and any filter applied (e.g. "Facial: ₹X received from 1–30 Sep"). If a filter matched several services or categories, say which ones were included.
- Money: use the exact formatted amounts the tool returns. "money received" is what was actually collected; "total billed" is the bill total. If the user just says "earned"/"revenue", give money received and mention total billed only if it differs.
- If a tool returns not_found, say so and offer the closest names it listed. If it says the user lacks permission or a module is locked, say you can't show that data to them and don't try another way.
- For "top / best / which" questions, call getSalesReport with a breakdown. In a ranking, quote each row's OWN amount (its_own_total_billed) next to its name — never use the period totals (money_received, total_billed) as a single item's figure.
- money_received is the Sales Summary "Received Amount" (cash actually collected); total_billed is its "Grand Total".
- To compare two periods, the tool already returns previous_period for the same filters; use it instead of a second call when the question is "vs the previous period".
- Keep answers short: 1–3 sentences, or a short list for rankings. No advice unless asked; at most one brief observation.
- You can only read data. You cannot change anything or predict the future.

${SECURITY_RULES}
If the question is not about this salon's numbers or SalonOx, reply with exactly: "${OUT_OF_SCOPE_REPLY}"`;
}

export const dataAssistantService = {
    async ask(user: AssistantUser, body: { message: string; history?: ChatTurn[] }): Promise<{ reply: string; toolsUsed: string[] }> {
        await assertWithinLimits(user);
        const salon = await salonsRepository.findById(user.salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        const tz = salon.timezone || "Asia/Kolkata";

        const history = (body.history ?? [])
            .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
            .slice(-HISTORY_LIMIT)
            .map((t) => ({ role: t.role, content: t.content.slice(0, 1500) }));
        const messages: LlmMessage[] = [
            { role: "system", content: systemPrompt(salon.business_name, tz) },
            ...history,
            { role: "user", content: body.message },
        ];
        const toolsUsed: string[] = [];

        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
            let response: LlmMessage;
            try {
                response = await llmClient.chat({ messages, tools: dataTools, salonId: user.salonId, userId: user.userId, maxTokens: 2000, temperature: 0.1 });
            } catch (err: any) {
                logger.error("[ai-assistant] ask-data LLM unavailable", { error: err?.message });
                return { reply: FALLBACK, toolsUsed };
            }
            if (!response.tool_calls?.length) return { reply: response.content?.trim() || FALLBACK, toolsUsed };

            messages.push(response);
            for (const call of response.tool_calls) {
                let args: Record<string, any> = {};
                try {
                    const parsed = JSON.parse(call.function.arguments || "{}");
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
                } catch {
                    // malformed args — the tool validates its own input
                }
                const tool = findDataTool(call.function.name);
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
                        logger.error("[ai-assistant] data tool failed", { tool: tool.name, error: err?.message });
                        result = { error: err instanceof AppError ? err.message : "This data is temporarily unavailable." };
                    }
                }
                messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS) });
            }
        }
        logger.warn("[ai-assistant] ask-data loop exceeded max iterations", { userId: user.userId, toolsUsed });
        return { reply: FALLBACK, toolsUsed };
    },
};
