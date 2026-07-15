import { couponsRepository } from "../../coupons/coupons.repository";
import { AgentContext, Tool } from "../ai-engine.types";

export const getOffersTool: Tool = {
    name: "getOffers",
    description:
        "List this salon's currently active discount codes/offers (type, value, minimum order amount, expiry). Use this whenever a customer asks about discounts, offers, or coupons — never invent an offer or a discount percentage.",
    parameters: { type: "object", properties: {} },
    async execute(_args, ctx: AgentContext) {
        const coupons = await couponsRepository.list(ctx.salonId);
        const now = Date.now();
        const active = coupons.filter((c) => new Date(c.expires_at).getTime() > now);

        return {
            offers: active.map((c) => ({
                code: c.code,
                type: c.type,
                value: c.value,
                min_order_amount: c.min_order_amount,
                expires_at: c.expires_at,
            })),
        };
    },
};
