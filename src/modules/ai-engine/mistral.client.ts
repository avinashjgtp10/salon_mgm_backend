import axios from "axios";
import config from "../../config/env";
import logger from "../../config/logger";
import { aiEngineRepository } from "./ai-engine.repository";
import { GroqChatCompletionResponse, GroqMessage, Tool } from "./ai-engine.types";

// Mistral's native API is already OpenAI-compatible — same request/response
// shape as Groq/Gemini, so the tool-calling loop in ai-engine.service.ts
// needs no changes.
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";

function toMistralTools(tools: Tool[]) {
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mistral's 429s don't consistently include a retry-after hint the way Gemini's
// do, so this stays on a fixed short delay — a brief 429/5xx here is usually a
// momentary rate-limit blip, not a real failure.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 4000;

export const mistralClient = {
    async chatCompletion(params: {
        messages: GroqMessage[];
        tools?: Tool[];
        salonId: string;
    }): Promise<GroqMessage> {
        let lastErr: any;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const { data } = await axios.post<GroqChatCompletionResponse>(
                    MISTRAL_URL,
                    {
                        model: MISTRAL_MODEL,
                        messages: params.messages,
                        ...(params.tools && params.tools.length > 0
                            ? { tools: toMistralTools(params.tools), tool_choice: "auto" }
                            : {}),
                        temperature: 0.4,
                        max_tokens: 500,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${config.mistral.apiKey}`,
                        },
                        timeout: 20_000,
                    }
                );

                if (data.usage) {
                    const { prompt_tokens, completion_tokens, total_tokens } = data.usage;
                    logger.info("[ai-engine] Mistral token usage", {
                        salonId: params.salonId,
                        model: MISTRAL_MODEL,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                    });
                    aiEngineRepository
                        .logTokenUsage({
                            salonId: params.salonId,
                            model: MISTRAL_MODEL,
                            promptTokens: prompt_tokens,
                            completionTokens: completion_tokens,
                            totalTokens: total_tokens,
                        })
                        .catch((err) => logger.error("[ai-engine] Failed to log token usage", { error: err?.message }));
                }

                const message = data.choices?.[0]?.message;
                if (!message) throw new Error("Mistral returned no message");
                return message;
            } catch (err: any) {
                lastErr = err;
                const status = err?.response?.status;
                const retryable = status === 429 || (status && status >= 500);

                logger.error("[ai-engine] Mistral chat completion failed", {
                    attempt,
                    status,
                    error: err?.response?.data ?? err?.message,
                });

                if (!retryable || attempt === MAX_RETRIES) break;
                await sleep(RETRY_DELAY_MS);
            }
        }

        throw lastErr;
    },
};
