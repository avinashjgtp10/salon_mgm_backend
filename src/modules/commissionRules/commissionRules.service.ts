import { AppError } from "../../middleware/error.middleware";
import { commissionRulesRepository } from "./commissionRules.repository";
import {
    CommissionRule,
    CommissionRuleListQuery,
    CreateCommissionRuleBody,
    UpdateCommissionRuleBody,
    CommissionRuleStatus,
} from "./commissionRules.types";

export const commissionRulesService = {
    async list(salonId: string, query: CommissionRuleListQuery): Promise<CommissionRule[]> {
        return commissionRulesRepository.list(salonId, query);
    },

    async getById(id: string, salonId: string): Promise<CommissionRule> {
        const rule = await commissionRulesRepository.findById(id, salonId);
        if (!rule) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        return rule;
    },

    /** Fans out into one rule row per selected staff member when scope_ids has more
     *  than one entry — each staff gets an independently-tracked rule (consistent
     *  with how the calculation engine matches rules per staff). */
    async create(salonId: string, body: CreateCommissionRuleBody): Promise<CommissionRule[]> {
        if (body.scope_type === "staff" && body.scope_ids && body.scope_ids.length > 0) {
            const created: CommissionRule[] = [];
            for (const staffId of body.scope_ids) {
                created.push(await commissionRulesRepository.create(salonId, body, staffId));
            }
            return created;
        }

        const scopeId = body.scope_type === "salon" ? null : (body.scope_id ?? null);
        return [await commissionRulesRepository.create(salonId, body, scopeId)];
    },

    async update(id: string, salonId: string, patch: UpdateCommissionRuleBody): Promise<CommissionRule> {
        const existing = await commissionRulesRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        const updated = await commissionRulesRepository.update(id, salonId, patch);
        if (!updated) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        return updated;
    },

    async updateStatus(id: string, salonId: string, status: CommissionRuleStatus): Promise<CommissionRule> {
        const existing = await commissionRulesRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        const updated = await commissionRulesRepository.updateStatus(id, salonId, status);
        if (!updated) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        return updated;
    },

    async delete(id: string, salonId: string): Promise<void> {
        const ok = await commissionRulesRepository.delete(id, salonId);
        if (!ok) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
    },
};
