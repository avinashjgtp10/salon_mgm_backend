import { AppError } from "../../middleware/error.middleware";
import { isModuleKey, MODULE_KEYS } from "../salon-modules/module-keys";
import { modulePlansRepository, PLAN_SLUGS, type PlanSlug } from "./module-plans.repository";

const isPlanSlug = (v: unknown): v is PlanSlug => typeof v === "string" && (PLAN_SLUGS as readonly string[]).includes(v);

export const modulePlansService = {
    // A plan nobody has configured yet comes back with every module locked, so it is built up from Off.
    async list() {
        const rows = await modulePlansRepository.list();
        return rows.map((r) => ({
            slug: r.slug as PlanSlug,
            name: r.name as string,
            configured: Boolean(r.configured),
            locked: r.configured ? (r.locked_modules as string[]).filter((k) => isModuleKey(k)) : [...MODULE_KEYS],
            updated_at: r.updated_at as string,
            updated_by_name: (r.updated_by_name as string | null) || null,
        }));
    },

    async set(slug: unknown, locked: unknown, updatedBy: string) {
        if (!updatedBy) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
        if (!isPlanSlug(slug)) throw new AppError(404, "Unknown plan", "NOT_FOUND");
        if (!Array.isArray(locked)) {
            throw new AppError(400, "locked must be an array of module keys", "VALIDATION_ERROR");
        }
        const invalid = locked.filter((k) => !isModuleKey(k));
        if (invalid.length > 0) {
            throw new AppError(400, `Unknown module key(s): ${invalid.map(String).join(", ")}`, "VALIDATION_ERROR");
        }
        await modulePlansRepository.save(slug, Array.from(new Set(locked as string[])), updatedBy);
        return (await this.list()).find((p) => p.slug === slug);
    },
};
