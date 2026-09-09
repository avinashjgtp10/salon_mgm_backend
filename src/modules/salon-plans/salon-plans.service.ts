import { AppError } from "../../middleware/error.middleware";
import { invalidatePlanFeatureCache, invalidateAllPlanFeatureCaches, loadSalonFeatureKeys } from "../../middleware/planFeature.middleware";
import { subscriptionsService } from "../subscriptions/subscriptions.service";
import {
    planDefinitionsRepository,
    salonCustomizationsRepository,
    salonPlanInvoicesRepository,
} from "./salon-plans.repository";
import {
    PlanTier,
    PLAN_TIER_ORDER,
    UpdatePlanDefinitionBody,
    UpsertSalonCustomizationBody,
    CreateInvoiceBody,
    ListInvoicesFilters,
} from "./salon-plans.types";

function assertValidTier(tier: string): asserts tier is PlanTier {
    if (!PLAN_TIER_ORDER.includes(tier as PlanTier)) {
        throw new AppError(400, `Invalid plan tier "${tier}" — must be one of ${PLAN_TIER_ORDER.join(", ")}`, "INVALID_TIER");
    }
}

export const salonPlansService = {
    // ── Plan Definitions ─────────────────────────────────────────────────────

    async listPlanDefinitions() {
        return planDefinitionsRepository.findAll();
    },

    async updatePlanDefinition(tier: string, patch: UpdatePlanDefinitionBody, updatedBy: string) {
        assertValidTier(tier);
        if (patch.price !== undefined && patch.price < 0) {
            throw new AppError(400, "Price cannot be negative", "VALIDATION_ERROR");
        }
        if (patch.features !== undefined) {
            if (!Array.isArray(patch.features) || patch.features.length === 0) {
                throw new AppError(400, "A plan must have at least one feature", "VALIDATION_ERROR");
            }
            if (new Set(patch.features).size !== patch.features.length) {
                throw new AppError(400, "Duplicate feature names are not allowed", "VALIDATION_ERROR");
            }
        }
        if (patch.feature_keys !== undefined) {
            const keyPattern = /^[a-z][a-z0-9_]*$/;
            if (!Array.isArray(patch.feature_keys)) {
                throw new AppError(400, "feature_keys must be an array", "VALIDATION_ERROR");
            }
            const keys = patch.feature_keys.map((f) => f.key);
            if (new Set(keys).size !== keys.length) {
                throw new AppError(400, "Duplicate feature keys are not allowed", "VALIDATION_ERROR");
            }
            for (const entry of patch.feature_keys) {
                if (!entry.key || !keyPattern.test(entry.key)) {
                    throw new AppError(400, `Invalid feature key "${entry.key}" — must be snake_case (lowercase letters, digits, underscores)`, "VALIDATION_ERROR");
                }
                if (!entry.label || !entry.label.trim()) {
                    throw new AppError(400, `Feature key "${entry.key}" needs a display label`, "VALIDATION_ERROR");
                }
            }
        }
        let updated = await planDefinitionsRepository.update(tier, patch, updatedBy);
        if (!updated) throw new AppError(404, "Plan tier not found", "NOT_FOUND");
        invalidateAllPlanFeatureCaches();

        // Razorpay plans are immutable (no "update price" API) — a price or
        // name edit here would otherwise leave checkout silently charging
        // the OLD amount forever against the previously-linked plan. Only
        // re-sync when one of those two actually changed, not on every save
        // (e.g. editing just the tagline or feature list shouldn't spawn a
        // new Razorpay plan object).
        if (patch.price !== undefined || patch.name !== undefined) {
            updated = await this.syncToRazorpay(tier, updatedBy);
        }
        return updated;
    },

    // Creates a real, checkout-capable Razorpay plan (via the existing
    // modules/subscriptions machinery — see that module's own createPlan,
    // which calls razorpay.plans.create() and stores the result in
    // subscription_plans) for this tier, and links it so the salon-facing
    // "Pay & Continue" button can create a live subscription against it.
    // Idempotent by re-running: each call creates a NEW Razorpay plan object
    // and re-links (Razorpay plans are immutable — there's no "update price"
    // on an existing one). Called automatically from updatePlanDefinition
    // whenever price/name change (see above); the standalone sync-razorpay
    // endpoint exists for the first-time sync and for manually re-running it
    // without any other field change.
    async syncToRazorpay(tier: string, updatedBy: string) {
        assertValidTier(tier);
        const plan = await planDefinitionsRepository.findByTier(tier);
        if (!plan) throw new AppError(404, "Plan tier not found", "NOT_FOUND");

        // slug must be globally unique on subscription_plans, and re-syncing
        // (e.g. after a price change) always needs a fresh row since
        // Razorpay plans are immutable — a fixed slug would collide with
        // the previous sync's row on the very next call.
        const created = await subscriptionsService.createPlan({
            name: `SalonOx ${plan.name}`,
            slug: `salonox-${plan.tier}-yearly-${Date.now()}`,
            description: plan.tagline ?? undefined,
            price: parseFloat(plan.price),
            billing_cycle: "yearly",
        });

        const linked = await planDefinitionsRepository.setLinkedSubscriptionPlan(tier, created.id, updatedBy);
        if (!linked) throw new AppError(500, "Failed to link plan after Razorpay sync", "SERVER_ERROR");
        return linked;
    },

    // ── Salon Customizations ─────────────────────────────────────────────────

    async searchCustomizations(query?: string) {
        return salonCustomizationsRepository.search(query);
    },

    async getCustomization(salonId: string) {
        const existing = await salonCustomizationsRepository.findBySalonId(salonId);
        if (existing) return existing;

        // No row yet = salon runs its base tier's plain defaults. Report the
        // Basic tier's own values back as a virtual (unsaved) customization
        // so the admin UI has something to show/edit before the first save —
        // mirrors how a salon with no billing_subscriptions row still shows
        // as "Free tier" rather than erroring.
        const basic = await planDefinitionsRepository.findByTier("basic");
        if (!basic) throw new AppError(500, "Plan catalog is not seeded", "CATALOG_MISSING");
        return {
            id: null,
            salon_id: salonId,
            base_tier: "basic" as PlanTier,
            custom_price: null,
            staff_limit: basic.default_staff_limit,
            customer_limit: basic.default_customer_limit,
            appointment_limit: basic.default_appointment_limit,
            branch_limit: basic.default_branch_limit,
            storage_limit_gb: basic.default_storage_limit_gb,
            feature_overrides: {},
            start_date: new Date().toISOString().slice(0, 10),
            expiry_date: null,
            updated_by: null,
            created_at: null,
            updated_at: null,
        };
    },

    async upsertCustomization(salonId: string, body: UpsertSalonCustomizationBody, updatedBy: string) {
        assertValidTier(body.base_tier);
        const plan = await planDefinitionsRepository.findByTier(body.base_tier);
        if (!plan) throw new AppError(404, "Plan tier not found", "NOT_FOUND");

        if (body.custom_price !== undefined && body.custom_price !== null && body.custom_price < 0) {
            throw new AppError(400, "Custom price cannot be negative", "VALIDATION_ERROR");
        }
        if (body.start_date && body.expiry_date && body.expiry_date <= body.start_date) {
            throw new AppError(400, "Expiry date must be after start date", "VALIDATION_ERROR");
        }
        const overrideKeys = Object.keys(body.feature_overrides ?? {});
        if (overrideKeys.length > 0) {
            const knownKeys = new Set(
                (await planDefinitionsRepository.findAll()).flatMap((p) => p.feature_keys.map((f) => f.key))
            );
            for (const key of overrideKeys) {
                if (!knownKeys.has(key)) {
                    throw new AppError(400, `Unknown feature key "${key}"`, "VALIDATION_ERROR");
                }
            }
        }

        const result = await salonCustomizationsRepository.upsert(salonId, body, updatedBy);
        invalidatePlanFeatureCache(salonId);
        return result;
    },

    async removeCustomization(salonId: string) {
        const removed = await salonCustomizationsRepository.remove(salonId);
        if (!removed) throw new AppError(404, "No customization found for this salon", "NOT_FOUND");
        invalidatePlanFeatureCache(salonId);
        return { removed: true };
    },

    // ── My Features / My Plan (salon-facing — what THIS logged-in salon has) ──

    async getMyFeatures(salonId: string) {
        const keys = await loadSalonFeatureKeys(salonId);
        return { features: Array.from(keys) };
    },

    // Powers the salon's own Billing page (Settings → Billing): its actual
    // Basic/Advance/Pro assignment plus the full catalog, so that page can
    // show real "Current Plan" + "Available Plans" cards instead of the
    // separate Razorpay billing_plans catalog, which has no relationship to
    // what super admin configures here.
    async getMyPlan(salonId: string) {
        const [customization, catalog] = await Promise.all([
            this.getCustomization(salonId),
            planDefinitionsRepository.findAll(),
        ]);
        const basePlan = catalog.find((p) => p.tier === customization.base_tier) ?? null;
        return {
            base_tier: customization.base_tier,
            // Effective price a salon owner actually pays: their custom price
            // if the super admin set one, otherwise the base tier's standard price.
            effective_price: customization.custom_price ?? basePlan?.price ?? null,
            is_customized: customization.custom_price !== null,
            start_date: customization.start_date,
            expiry_date: customization.expiry_date,
            catalog,
        };
    },

    // ── Invoices ──────────────────────────────────────────────────────────────

    async listInvoices(filters: ListInvoicesFilters) {
        const [list, summary] = await Promise.all([
            salonPlanInvoicesRepository.list(filters),
            salonPlanInvoicesRepository.summary(),
        ]);
        return { ...list, summary };
    },

    async createInvoice(body: CreateInvoiceBody, createdBy: string) {
        assertValidTier(body.plan_tier);
        if (body.amount <= 0) throw new AppError(400, "Amount must be greater than zero", "VALIDATION_ERROR");
        return salonPlanInvoicesRepository.create(body, createdBy);
    },

    async updateInvoiceStatus(id: string, status: string) {
        const valid = ["paid", "open", "overdue", "void"];
        if (!valid.includes(status)) {
            throw new AppError(400, `Invalid status "${status}" — must be one of ${valid.join(", ")}`, "VALIDATION_ERROR");
        }
        const updated = await salonPlanInvoicesRepository.updateStatus(id, status);
        if (!updated) throw new AppError(404, "Invoice not found", "NOT_FOUND");
        return updated;
    },
};
