import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { salonsRepository } from "../salons/salons.repository";
import { branchesRepository } from "../branches/branches.repository";
import { inboxRepository } from "../marketing/whatsapp/inbox/inbox.repository";
import { inboxService } from "../marketing/whatsapp/inbox/inbox.service";
import { mistralClient } from "./mistral.client";
import { soxiTools, findTool, resolveClient } from "./tools";
import { buildSystemPrompt } from "./prompts/system.prompt";
import { aiEngineRepository } from "./ai-engine.repository";
import { AgentContext, ChatResult, GroqMessage } from "./ai-engine.types";

// A full booking flow (search service -> find staff -> check availability -> book)
// is already 4 calls; each self-corrected bad-id retry (see id-validation.ts)
// costs 2 more, so 5 was cutting off a booking one step before completion.
const MAX_TOOL_ITERATIONS = 8;
const HISTORY_LIMIT = 10;
const FALLBACK_REPLY = "I'm having trouble with that right now — let me get one of our team to help you.";

async function buildContextAndHistory(salonId: string, phone: string, name: string | null) {
    const client = await resolveClient(salonId, phone, name);
    const ctx: AgentContext = {
        salonId,
        clientId: client.id,
        phone,
        customerName: name ?? client.full_name ?? null,
    };

    const [salon, branches, pastMessages, memory] = await Promise.all([
        salonsRepository.findById(salonId),
        branchesRepository.listBySalonId(salonId),
        inboxRepository.getMessages(salonId, phone),
        aiEngineRepository.getMemory(salonId, phone),
    ]);

    if (!salon) throw new Error(`Salon ${salonId} not found`);
    const mainBranch = branches.find((b) => b.is_main) ?? branches[0] ?? null;

    // pastMessages includes the just-saved current inbound message, plus any
    // outbound-only marketing campaign blasts sent before the customer ever
    // actually messaged LUNOX — neither of those should count as "prior
    // conversation", so this only counts real inbound customer messages.
    const inboundCount = pastMessages.filter((m) => m.direction === "INBOUND").length;
    let systemPrompt = buildSystemPrompt({
        salon,
        branch: mainBranch,
        customerName: ctx.customerName,
        isFirstMessage: inboundCount <= 1,
    });
    if (memory?.notes || memory?.preferred_language || memory?.preferred_staff_id || memory?.birthday) {
        systemPrompt += `\n\nWhat you remember about this customer: ${[
            memory.preferred_language ? `prefers ${memory.preferred_language}` : null,
            memory.preferred_staff_id ? `prefers staff_id ${memory.preferred_staff_id}` : null,
            memory.birthday ? `birthday is ${memory.birthday}` : null,
            memory.notes,
        ]
            .filter(Boolean)
            .join("; ")}. Whenever you learn something new worth remembering, call updateCustomerMemory.`;
    }

    const history: GroqMessage[] = pastMessages.slice(-HISTORY_LIMIT).map((m) => ({
        role: m.direction === "INBOUND" ? "user" : "assistant",
        content: m.body,
    }));

    return { ctx, systemPrompt, history };
}

async function runAgentLoop(
    systemPrompt: string,
    history: GroqMessage[],
    userMessage: string,
    ctx: AgentContext
): Promise<ChatResult> {
    const messages: GroqMessage[] = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
    ];
    const toolCalls: ChatResult["toolCalls"] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        let response: GroqMessage;
        try {
            response = await mistralClient.chatCompletion({ messages, tools: soxiTools, salonId: ctx.salonId });
        } catch (err: any) {
            // The LLM itself is unreachable/rate-limited even after retries —
            // the customer must get *something* back rather than silence.
            logger.error("[ai-engine] LLM call failed after retries, falling back", { error: err?.message });
            return { reply: FALLBACK_REPLY, toolCalls };
        }

        if (!response.tool_calls || response.tool_calls.length === 0) {
            const content = response.content?.trim();
            if (!content) {
                // The LLM call itself succeeded (no exception, no retry) but returned
                // empty content and no tool call — without this log, this case is
                // otherwise silent and indistinguishable from a real API failure.
                logger.warn("[ai-engine] LLM returned empty content with no tool calls, falling back", {
                    phone: ctx.phone,
                });
            }
            return { reply: content || FALLBACK_REPLY, toolCalls };
        }

        messages.push(response);

        for (const call of response.tool_calls) {
            let args: Record<string, any> = {};
            try {
                const parsed = JSON.parse(call.function.arguments || "{}");
                // Models sometimes send the literal string "null" for zero-arg calls,
                // which parses fine but isn't an object — tools then crash reading
                // properties off it. Guard so a bare null/array never reaches a tool.
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    args = parsed;
                }
            } catch {
                // malformed args from the model — treat as empty, let the tool validate
            }

            const tool = findTool(call.function.name);
            let result: unknown;
            try {
                if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
                result = await tool.execute(args, ctx);
            } catch (err: any) {
                logger.error("[ai-engine] tool execution failed", {
                    tool: call.function.name,
                    error: err?.message,
                });
                // AppError messages are already customer-safe business errors
                // (e.g. "Staff member already has an appointment at this time",
                // "Appointment not found") — pass them through so the model can
                // react intelligently (retry a different slot, ask a follow-up)
                // instead of treating every failure as a system outage and
                // escalating to a human unnecessarily.
                result = { error: err instanceof AppError ? err.message : "This action is temporarily unavailable." };
            }

            toolCalls.push({ name: call.function.name, args, result });
            messages.push({
                role: "tool",
                tool_call_id: call.id,
                name: call.function.name,
                content: JSON.stringify(result),
            });
        }
    }

    logger.warn("[ai-engine] tool-call loop exceeded max iterations, falling back", {
        phone: ctx.phone,
        toolsCalled: toolCalls.map((t) => t.name),
    });
    return { reply: FALLBACK_REPLY, toolCalls };
}

export const aiEngineService = {
    // Debug/internal entry point — returns the reply without sending via WhatsApp.
    async chat(params: { salonId: string; phone: string; message: string; name?: string | null }): Promise<ChatResult> {
        const startedAt = Date.now();
        const { ctx, systemPrompt, history } = await buildContextAndHistory(params.salonId, params.phone, params.name ?? null);
        const result = await runAgentLoop(systemPrompt, history, params.message, ctx);

        aiEngineRepository
            .logInteraction({
                salonId: params.salonId,
                phone: params.phone,
                userMessage: params.message,
                toolCalls: result.toolCalls,
                assistantReply: result.reply,
                latencyMs: Date.now() - startedAt,
            })
            .catch((err) => logger.warn("[ai-engine] logInteraction failed", { err: err?.message }));

        return result;
    },

    // Live WhatsApp entry point — generates a reply AND sends it back to the customer.
    async handleIncomingMessage(params: { salonId: string; phone: string; name: string | null; text: string }): Promise<void> {
        try {
            const result = await this.chat({
                salonId: params.salonId,
                phone: params.phone,
                message: params.text,
                name: params.name,
            });
            await inboxService.sendReply(params.salonId, params.phone, result.reply);
        } catch (err: any) {
            logger.error("[ai-engine] handleIncomingMessage failed", {
                salonId: params.salonId,
                phone: params.phone,
                error: err?.message,
            });
            // The whole pipeline died before any reply was generated (e.g. a DB
            // blip) — silence is worse than a generic apology, so always try to
            // get the customer *something* back rather than leaving them hanging.
            try {
                await inboxService.sendReply(params.salonId, params.phone, FALLBACK_REPLY);
            } catch (sendErr: any) {
                logger.error("[ai-engine] fallback reply also failed to send", {
                    salonId: params.salonId,
                    phone: params.phone,
                    error: sendErr?.message,
                });
            }
        }
    },
};
