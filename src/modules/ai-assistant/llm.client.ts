import axios from "axios";
import config from "../../config/env";
import logger from "../../config/logger";
import { aiAssistantRepository } from "./ai-assistant.repository";
import { requireSalonAiCredentials } from "../ai-credentials/ai-credentials.service";
import { LlmMessage, Tool } from "./ai-assistant.types";
import { hasProtocolContent, InvalidLlmReplyError, isDegenerateReply } from "./reply-validation";

// Cloudflare Workers AI exposes an OpenAI-compatible chat-completions endpoint, including tool calling and JSON mode.
const cfUrl = (accountId: string) => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const llmClient = {
    async chat(params: {
        messages: LlmMessage[];
        tools?: Tool[];
        salonId: string;
        userId: string;
        maxTokens?: number;
        temperature?: number;
        json?: boolean;
    }): Promise<LlmMessage> {
        // The salon's own Cloudflare key (set by Super Admin). No key = LUNOX is locked for this salon.
        const { accountId, apiToken } = await requireSalonAiCredentials(params.salonId);
        let lastErr: any;
        let stuck = false;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const { data } = await axios.post(
                    cfUrl(accountId),
                    {
                        model: config.cloudflare.textModel,
                        // Cloudflare rejects a null content (the assistant turn that only carries tool calls), so send "" instead
                        messages: params.messages.map((m) => (m.content === null ? { ...m, content: "" } : m)),
                        ...(params.tools?.length
                            ? {
                                  tools: params.tools.map((t) => ({
                                      type: "function",
                                      function: { name: t.name, description: t.description, parameters: t.parameters },
                                  })),
                                  tool_choice: "auto",
                              }
                            : {}),
                        // A retry after a stuck reply ("!!!!…") runs warmer: very low temperatures are what let a model fall into
                        // repeating one token, and a different sample is enough to break out of it.
                        temperature: attempt > 0 && stuck ? Math.max(params.temperature ?? 0.3, 0.6) : (params.temperature ?? 0.3),
                        // gpt-oss models spend part of this budget on hidden reasoning; too small a cap
                        // truncates the answer (or breaks JSON mode), so keep it roomy and the reasoning short.
                        max_tokens: params.maxTokens ?? 2000,
                        ...(/gpt-oss/i.test(config.cloudflare.textModel) ? { reasoning_effort: "low" } : {}),
                        ...(params.json ? { response_format: { type: "json_object" } } : {}),
                    },
                    {
                        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
                        timeout: 30_000,
                    }
                );

                if (data.usage) {
                    aiAssistantRepository
                        .logUsage({
                            salonId: params.salonId,
                            userId: params.userId,
                            kind: "chat",
                            model: config.cloudflare.textModel,
                            tokens: data.usage.total_tokens ?? 0,
                        })
                        .catch((err) => logger.warn("[ai-assistant] usage log failed", { error: err?.message }));
                }

                const message = data.choices?.[0]?.message;
                if (!message) throw new Error("LLM returned no message");
                // Retry malformed provider output; never interpret tool commands
                // embedded in plain text or expose that text as an answer.
                if (!message.tool_calls?.length && hasProtocolContent(message.content)) {
                    throw new InvalidLlmReplyError();
                }
                // A reply that is just one repeated character is a stuck model, not an answer: retry (warmer) like any bad output.
                if (!message.tool_calls?.length && isDegenerateReply(message.content)) {
                    stuck = true;
                    throw new InvalidLlmReplyError();
                }
                if (hasProtocolContent(message.content)) message.content = null;
                // drop the model's hidden-reasoning fields so only role / content / tool_calls are sent back on the next turn
                return { role: message.role, content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) } as LlmMessage;
            } catch (err: any) {
                lastErr = err;
                const status = err?.response?.status;
                logger.error("[ai-assistant] LLM call failed", { attempt, status, error: err?.response?.data?.error ?? err?.message });
                const retryable = err instanceof InvalidLlmReplyError || status === 429 || (status && status >= 500);
                if (!retryable || attempt === MAX_RETRIES) break;
                await sleep(RETRY_DELAY_MS * (attempt + 1));
            }
        }
        throw lastErr;
    },
};
