import { AppError } from "../../middleware/error.middleware";
import { invalidateModuleLockCache } from "../../middleware/moduleLock.middleware";
import { isModuleKey, MODULE_KEYS } from "./module-keys";
import { salonModulesRepository } from "./salon-modules.repository";
import { modulePlansRepository } from "../module-plans/module-plans.repository";

export const salonModulesService = {
    async searchSalons(query: string) {
        return salonModulesRepository.searchSalons(query ?? "");
    },

    async getForSalon(salonId: string) {
        if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
        const salon = await salonModulesRepository.findSalon(salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");
        const [locked, audit] = await Promise.all([
            salonModulesRepository.getLockedKeys(salonId),
            salonModulesRepository.getAuditLog(salonId),
        ]);
        return { salon, locked, audit };
    },

    // Gives a salon the feature set of a plan (module_plans -> salon_module_locks). A plan whose features were never
    // configured is left alone, so an upgrade can't accidentally lock or unlock everything.
    async applyPlanTier(salonId: string, tier: string, changedByUserId: string): Promise<boolean> {
        const plans = await modulePlansRepository.list();
        const plan = plans.find((p: any) => p.slug === tier);
        if (!plan || !plan.configured) return false;
        const locked = (Array.isArray(plan.locked_modules) ? plan.locked_modules : []).filter((k: unknown) => isModuleKey(k));
        await salonModulesRepository.setLockedKeys(salonId, locked as string[], changedByUserId);
        invalidateModuleLockCache(salonId);
        return true;
    },

    async setForSalon(salonId: string, locked: unknown, changedByUserId: string) {
        if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
        if (!changedByUserId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
        if (!Array.isArray(locked)) {
            throw new AppError(400, "locked must be an array of module keys", "VALIDATION_ERROR");
        }
        const invalid = locked.filter((k) => !isModuleKey(k));
        if (invalid.length > 0) {
            throw new AppError(
                400,
                `Unknown module key(s): ${invalid.map(String).join(", ")}. Valid keys: ${MODULE_KEYS.join(", ")}`,
                "VALIDATION_ERROR"
            );
        }
        const salon = await salonModulesRepository.findSalon(salonId);
        if (!salon) throw new AppError(404, "Salon not found", "NOT_FOUND");

        const unique = Array.from(new Set(locked as string[]));
        const result = await salonModulesRepository.setLockedKeys(salonId, unique, changedByUserId);
        // Applies at once on this instance; other instances within the 60s cache TTL.
        invalidateModuleLockCache(salonId);
        return result;
    },
};
