import { productsRepository } from "../../products/products.repository";
import { AgentContext, Tool } from "../ai-engine.types";

export const getProductsTool: Tool = {
    name: "getProducts",
    description:
        "List retail products the salon sells (e.g. shampoo, styling products) with real pricing. Use this to answer any question about what products are available or how much they cost — never guess a product name or price.",
    parameters: {
        type: "object",
        properties: {
            search: { type: "string", description: "Optional keyword to filter products, e.g. 'shampoo'" },
        },
    },
    async execute(args, ctx: AgentContext) {
        const { data } = await productsRepository.list(
            { search: args.search, retail_sales_enabled: true, stock: "all", limit: 30 },
            ctx.salonId
        );
        return {
            products: data.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.short_description ?? p.description,
                price: p.retail_price,
                in_stock: p.amount > 0,
            })),
        };
    },
};
