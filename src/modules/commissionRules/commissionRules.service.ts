import { AppError } from "../../middleware/error.middleware";
import { commissionRulesRepository } from "./commissionRules.repository";
import {
    CommissionRule,
    CommissionRuleListQuery,
    CreateCommissionRuleBody,
    UpdateCommissionRuleBody,
    CommissionRuleStatus,
    LadderTier,
} from "./commissionRules.types";

const SOURCE_LABELS: Record<string, string> = {
    services: "Services", products: "Products", memberships: "Memberships", packages: "Packages",
};

/** Sorts steps ascending and derives `rate` (= total of all rewards, i.e. the max
 *  a full month pays) so the NOT-NULL-ish `rate` column and list views stay meaningful. */
const normalizeLadder = <T extends { type?: string; tiers?: LadderTier[] | null; rate?: number }>(body: T): T => {
    if (body.type !== "milestone_ladder" || !body.tiers) return body;
    const tiers = [...body.tiers]
        .map((t) => ({ target: Number(t.target), reward: Number(t.reward) }))
        .sort((a, b) => a.target - b.target);
    return {
        ...body,
        tiers,
        rate: tiers.reduce((sum, t) => sum + t.reward, 0),
        condition_target: null,
        condition_metric: null,
    };
};

/** A Milestone Ladder and every other rule type are mutually exclusive per staff +
 *  source while active — the user must delete (or deactivate) one before using the other. */
async function assertNoKindConflict(
    salonId: string,
    rule: { source: string; type: string; scope_type: string; scope_id: string | null; status?: string },
    excludeId?: string
): Promise<void> {
    if (rule.status !== "active") return;
    const clash = await commissionRulesRepository.findConflictingKind(salonId, rule, excludeId);
    if (!clash) return;
    const source = SOURCE_LABELS[rule.source] ?? rule.source;
    const [have, want] = clash.type === "milestone_ladder"
        ? ["Milestone Ladder", "regular commission rule"]
        : ["regular commission rule", "Milestone Ladder"];
    throw new AppError(
        409,
        `This staff member already has an active ${have} for ${source} ("${clash.name}"). Delete it first to use a ${want}.`,
        "RULE_KIND_CONFLICT"
    );
}

export const commissionRulesService = {
    async list(salonId: string, query: CommissionRuleListQuery): Promise<CommissionRule[]> {
        return commissionRulesRepository.list(salonId, query);
    },

    async getById(id: string, salonId: string): Promise<CommissionRule> {
        const rule = await commissionRulesRepository.findById(id, salonId);
        if (!rule) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        return rule;
    },

    async getTieredTargetProgress(id: string, salonId: string) {
        const progress = await commissionRulesRepository.getTieredTargetProgress(id, salonId);
        if (!progress) throw new AppError(404, "No monthly target progress for this rule", "NOT_FOUND");
        const { target, achieved } = progress;
        const remaining = Math.max(0, target - achieved);
        const progressPct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;
        return { target, achieved, remaining, progressPct, targetReached: achieved >= target };
    },

    /** Fans out into one rule row per selected staff member when scope_ids has more
     *  than one entry — each staff gets an independently-tracked rule (consistent
     *  with how the calculation engine matches rules per staff). */
    async create(salonId: string, rawBody: CreateCommissionRuleBody): Promise<CommissionRule[]> {
        const body = normalizeLadder(rawBody);
        const scopeType = body.scope_type ?? "salon";
        const scopeIds = scopeType === "staff" && body.scope_ids && body.scope_ids.length > 0
            ? body.scope_ids
            : [scopeType === "salon" ? null : (body.scope_id ?? null)];

        // Check every target up front so a clash on the 3rd staff member doesn't
        // leave the first two already created.
        for (const scopeId of scopeIds) {
            await assertNoKindConflict(salonId, {
                source: body.source, type: body.type, scope_type: scopeType, scope_id: scopeId,
                status: body.status ?? "draft",
            });
        }

        const created: CommissionRule[] = [];
        for (const scopeId of scopeIds) {
            created.push(await commissionRulesRepository.create(salonId, body, scopeId));
        }
        return created;
    },

    async update(id: string, salonId: string, rawPatch: UpdateCommissionRuleBody): Promise<CommissionRule> {
        const existing = await commissionRulesRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        const patch = normalizeLadder({ ...rawPatch, type: rawPatch.type ?? existing.type });
        if (rawPatch.type === undefined) delete (patch as any).type;
        await assertNoKindConflict(salonId, {
            source: patch.source ?? existing.source,
            type: patch.type ?? existing.type,
            scope_type: patch.scope_type ?? existing.scope_type,
            scope_id: patch.scope_id !== undefined ? patch.scope_id : existing.scope_id,
            status: patch.status ?? existing.status,
        }, id);
        const updated = await commissionRulesRepository.update(id, salonId, patch);
        if (!updated) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        return updated;
    },

    async updateStatus(id: string, salonId: string, status: CommissionRuleStatus): Promise<CommissionRule> {
        const existing = await commissionRulesRepository.findById(id, salonId);
        if (!existing) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        await assertNoKindConflict(salonId, { ...existing, status }, id);
        const updated = await commissionRulesRepository.updateStatus(id, salonId, status);
        if (!updated) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
        return updated;
    },

    async delete(id: string, salonId: string): Promise<void> {
        const ok = await commissionRulesRepository.delete(id, salonId);
        if (!ok) throw new AppError(404, "Commission rule not found", "NOT_FOUND");
    },
};
