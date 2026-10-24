import logger from "../../../config/logger";
import { OUT_OF_SCOPE_REPLY, SECURITY_RULES } from "../rules";
import { AppError } from "../../../middleware/error.middleware";
import { salonsRepository } from "../../salons/salons.repository";
import { assertWithinLimits, userCanUse } from "../ai-assistant.service";
import { llmClient } from "../llm.client";
import { AssistantUser, ChatTurn, LlmMessage } from "../ai-assistant.types";
import { dataTools, findDataTool } from "./data.tools";
import { todayIn } from "./periods";

const MAX_TOOL_ITERATIONS = 5;
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
- Keep answers short: 1–3 sentences, or a short list for rankings. Don't add advice to a plain numbers question.
- Advice IS in scope when the manager asks for it ("how can I increase sales", "what should I focus on", "any more suggestions"). Never refuse these. Your advice is about CAMPAIGNS and OFFERS to real customer groups, using SalonOx's own tools — not generic business tips and not product-bundling tricks.
- How to answer an advice question: (1) call tools first: getSalesReport for the period (it includes the previous period) with a breakdown by services; getLostClients (win-back audience); getRebookingRate for the last 30–90 days (use period=last_30_days, or custom dates for 90 days); getNewClients if useful. (2) Give 3 numbered suggestions, each a concrete campaign or offer. Each one must say: WHO to message (a real group, with its real count from a tool, e.g. "the 142 clients not seen for 90+ days, 38 of them regulars"), WHAT offer or message idea to send (tied to a real service or product from the tool results, e.g. a comeback offer on your top service), and HOW in SalonOx (Marketing > Campaigns, or a WhatsApp template you approve first). (3) End with one line that nothing is sent automatically — they review and approve each campaign.
- Good campaign ideas to choose from, only when the data supports them: win-back offer for clients not seen for a while (start with regulars and the shortest time away); rebooking reminder or next-visit offer when the rebooking rate is low; a promotion on a service that sells little compared with the top ones; a package or membership offer for repeat clients; a welcome offer or follow-up for new clients; a seasonal or festival offer; a referral offer; a birthday message. Do not suggest the same lever twice, and on a follow-up like "any more suggestions" give DIFFERENT ones.
- Advice rules: never state a projected result (no "would add ₹X", no "+10% uplift", no "converting 5% gives…"); never claim a product or service is high-margin or low-margin; never invent a discount amount or price — say "an offer of your choice" or "a small welcome-back discount"; every figure you quote must have come from a tool this turn. No payment-method advice (cash/card/UPI); no weekday claims unless a tool gave per-weekday figures; never name or judge a team member or a client; if a tool is unavailable to this user or the data is too thin, say so and suggest what you can from the rest.
- Counting rules (important): number_of_bills counts BILLS and rebooked_visits / visits count VISITS — one client can have several. Never call them "clients" or "customers". Only getLostClients and getNewClients return client counts. If you don't have a client count, describe the audience in words (e.g. "clients who visited last month", "clients who rebooked") without a number, or give the number labelled as bills or visits.
- Don't use a service's total_billed (its period total) as its price or as the value of a reward. You do not know any service's price unless a tool returned it, so say "a free add-on service of your choice" instead of naming a price.
- Only suggest things SalonOx really has, and point to the right screen: WhatsApp campaigns and templates = Marketing > Campaigns / Templates; membership plans = Catalog > Memberships (create the plan first, then message clients about it); referral and reward points = Clients > Referral & rewards. Do NOT design a loyalty scheme with invented rules (no "1 point per ₹100", no thresholds, no "10% discount", no fixed rewards) — say the manager sets the amounts.
- Give at most ONE product-bundle suggestion in a conversation; the rest should be about clients (win-back, rebooking, membership, referral, welcome, birthday, seasonal), with a DIFFERENT lever each time.
- Keep an advice answer under about 150 words.
- You can only read data. You cannot change anything or predict the future.

${SECURITY_RULES}
Questions about this salon's numbers, how to grow or improve the business from them, and SalonOx are in scope. Only if the question is clearly about something else (general knowledge, coding, entertainment, other topics), reply with exactly: "${OUT_OF_SCOPE_REPLY}"`;
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
