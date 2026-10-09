import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { invalidatePlanFeatureCache, invalidateAllPlanFeatureCaches, loadSalonFeatureKeys } from "../../middleware/planFeature.middleware";
import { superAdminRepository } from "../super-admin/super-admin.repository";
import { emailService } from "../utils/email.service";
import { renderSalonPlanInvoicePdf } from "./salon-plan-invoice-pdf.service";
import logger from "../../config/logger";
import {
    planDefinitionsRepository,
    planPricesRepository,
    salonCustomizationsRepository,
    salonPlanInvoicesRepository,
} from "./salon-plans.repository";
import {
    PlanTier,
    PLAN_TIER_ORDER,
    GST_RATE_PERCENT,
    BILLING_CYCLES,
    SalonPlanDefinition,
    SalonPlanDefinitionWithPrices,
    UpdatePlanPricesBody,
    UpdatePlanDefinitionBody,
    UpsertSalonCustomizationBody,
    CreateInvoiceBody,
    ListInvoicesFilters,
    BILLING_CYCLE_LABEL,
    BillingCycle,
} from "./salon-plans.types";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigitsWords(n: number): string { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function threeDigitsWords(n: number): string { return n < 100 ? twoDigitsWords(n) : `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " + twoDigitsWords(n % 100) : ""}`; }
function amountInWords(n: number): string {
    const rupees = Math.floor(n);
    if (rupees === 0) return "Rupees Zero Only";
    const crore = Math.floor(rupees / 10000000);
    const lakh = Math.floor((rupees % 10000000) / 100000);
    const thousand = Math.floor((rupees % 100000) / 1000);
    const hundred = rupees % 1000;
    const parts: string[] = [];
    if (crore) parts.push(`${threeDigitsWords(crore)} Crore`);
    if (lakh) parts.push(`${threeDigitsWords(lakh)} Lakh`);
    if (thousand) parts.push(`${threeDigitsWords(thousand)} Thousand`);
    if (hundred) parts.push(threeDigitsWords(hundred));
    return `Rupees ${parts.join(" ")} Only`;
}

function assertValidTier(tier: string): asserts tier is PlanTier {
    if (!PLAN_TIER_ORDER.includes(tier as PlanTier)) {
        throw new AppError(400, `Invalid plan tier "${tier}" — must be one of ${PLAN_TIER_ORDER.join(", ")}`, "INVALID_TIER");
    }
}

export const salonPlansService = {
    // ── Plan Definitions ─────────────────────────────────────────────────────

    // Attaches the per-cycle price map to each definition. `annual` falls
    // back to the legacy single price column so nothing renders blank before
    // the prices migration has been run.
    async withPrices(defs: SalonPlanDefinition[]): Promise<SalonPlanDefinitionWithPrices[]> {
        const byTier = await planPricesRepository.findAllByTier();
        return defs.map((d) => {
            const p = byTier[d.tier] ?? {};
            return {
                ...d,
                prices: {
                    monthly: p.monthly ?? null,
                    quarterly: p.quarterly ?? null,
                    annual: p.annual ?? d.price,
                },
            };
        });
    },

    async listPlanDefinitions() {
        return this.withPrices(await planDefinitionsRepository.findAll());
    },

    // Super-admin: set any of the 3 cycle prices (before GST) for one tier.
    async updatePlanPrices(tier: string, body: UpdatePlanPricesBody, updatedBy: string) {
        assertValidTier(tier);
        const entries = Object.entries(body ?? {}).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
            throw new AppError(400, "Provide at least one of monthly, quarterly, annual", "VALIDATION_ERROR");
        }
        const clean: Partial<Record<BillingCycle, number>> = {};
        for (const [cycle, value] of entries) {
            if (!BILLING_CYCLES.includes(cycle as BillingCycle)) {
                throw new AppError(400, `Invalid billing cycle "${cycle}" — must be one of ${BILLING_CYCLES.join(", ")}`, "VALIDATION_ERROR");
            }
            const n = Number(value);
            if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) {
                throw new AppError(400, `${cycle} price must be a positive number`, "VALIDATION_ERROR");
            }
            clean[cycle as BillingCycle] = Math.round(n * 100) / 100;
        }
        const def = await planDefinitionsRepository.findByTier(tier);
        if (!def) throw new AppError(404, "Plan tier not found", "NOT_FOUND");

        await planPricesRepository.upsertMany(tier, clean, updatedBy);
        invalidateAllPlanFeatureCaches();

        const fresh = await planDefinitionsRepository.findByTier(tier);
        const [withPrices] = await this.withPrices([fresh!]);
        return withPrices;
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
        const updated = await planDefinitionsRepository.update(tier, patch, updatedBy);
        if (!updated) throw new AppError(404, "Plan tier not found", "NOT_FOUND");
        // The legacy single `price` IS the annual price — keep the new
        // per-cycle table in step if an older client still edits it.
        if (patch.price !== undefined) {
            try {
                await planPricesRepository.upsertMany(tier, { annual: patch.price }, updatedBy);
            } catch (err: any) {
                if (err?.code !== "42P01") throw err; // prices migration not run yet
            }
        }
        invalidateAllPlanFeatureCaches();
        const [withPrices] = await this.withPrices([updated]);
        return withPrices;
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
    // separate billing_plans catalog, which has no relationship to what
    // super admin configures here.
    async getMyPlan(salonId: string) {
        const [customization, catalog] = await Promise.all([
            this.getCustomization(salonId),
            planDefinitionsRepository.findAll().then((defs) => this.withPrices(defs)),
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
            gst_rate_percent: GST_RATE_PERCENT,
            catalog,
        };
    },

    // ── Invoices ──────────────────────────────────────────────────────────────

    // Kept for BillingInvoicesTab.tsx (Plans & Subscriptions' own simpler
    // tab) — unchanged shape (list + a global, unfiltered summary).
    async listInvoices(filters: ListInvoicesFilters) {
        const [list, summary] = await Promise.all([
            salonPlanInvoicesRepository.list(filters),
            salonPlanInvoicesRepository.summary({}),
        ]);
        return { ...list, summary };
    },

    // Powers the redesigned Billing & Invoices page — filtered summary (the
    // 5 KPI cards react to the same date/branch/status/search filters as
    // the table), distinct from listInvoices' global summary above.
    async listInvoicesFiltered(filters: ListInvoicesFilters) {
        return salonPlanInvoicesRepository.list(filters);
    },

    async invoicesSummary(filters: ListInvoicesFilters) {
        return salonPlanInvoicesRepository.summary(filters);
    },

    // Billing & Invoices page: list + summary + branch dropdown in one round trip.
    async invoicesOverview(filters: ListInvoicesFilters) {
        const [list, summary, branches] = await Promise.all([
            salonPlanInvoicesRepository.list(filters),
            salonPlanInvoicesRepository.summary(filters),
            salonPlanInvoicesRepository.listDistinctBranches(),
        ]);
        return { list, summary, branches };
    },

    async invoiceBranches() {
        return salonPlanInvoicesRepository.listDistinctBranches();
    },

    async createInvoice(body: CreateInvoiceBody, createdBy: string) {
        assertValidTier(body.plan_tier);
        if (body.amount <= 0) throw new AppError(400, "Amount must be greater than zero", "VALIDATION_ERROR");
        if (!body.period_start || !body.period_end) {
            throw new AppError(400, "period_start and period_end are required", "VALIDATION_ERROR");
        }
        if (!["monthly", "quarterly", "annual"].includes(body.billing_cycle)) {
            throw new AppError(400, "Invalid billing_cycle", "VALIDATION_ERROR");
        }
        const invoice = await salonPlanInvoicesRepository.create(body, createdBy);

        // Fire-and-forget: the salon owner's invoice PDF email must never
        // block or fail the invoice creation response itself.
        this._emailInvoiceToSalonOwner(invoice.id).catch((err) => {
            logger.error(`Failed to email invoice ${invoice.id} to salon owner`, { err });
        });

        return invoice;
    },

    async updateInvoiceStatus(id: string, status: string) {
        const valid = ["paid", "open", "pending", "overdue", "failed", "void"];
        if (!valid.includes(status)) {
            throw new AppError(400, `Invalid status "${status}" — must be one of ${valid.join(", ")}`, "VALIDATION_ERROR");
        }
        const updated = await salonPlanInvoicesRepository.updateStatus(id, status);
        if (!updated) throw new AppError(404, "Invoice not found", "NOT_FOUND");
        return updated;
    },

    async deleteInvoice(id: string) {
        const removed = await salonPlanInvoicesRepository.remove(id);
        if (!removed) throw new AppError(404, "Invoice not found", "NOT_FOUND");
        return { deleted: true };
    },

    // Assembles the print-ready payload for the invoice preview panel AND
    // the emailed PDF (see _emailInvoiceToSalonOwner below) — the invoice
    // itself, the seller's (SalonoX's own) details + bank account —
    // hardcoded here since this invoice is SalonoX billing the salon, not
    // the salon billing its own clients (contrast with
    // salon-client-invoices.service.ts's getForPrint, which pulls the
    // SALON's own gst_number/bank columns as the seller).
    async _buildPrintPayload(id: string) {
        const invoice = await salonPlanInvoicesRepository.findByIdWithSalon(id);
        if (!invoice) throw new AppError(404, "Invoice not found", "NOT_FOUND");

        const { rows } = await pool.query(
            `SELECT business_name, address, address_line2, phone, email
             FROM salons WHERE id = $1`,
            [invoice.salon_id]
        );
        const salon = rows[0] ?? {};

        const totalAmount = Number(invoice.amount);
        return {
            invoice: {
                ...invoice,
                plan_label: BILLING_CYCLE_LABEL[invoice.billing_cycle as BillingCycle] ?? invoice.billing_cycle,
            },
            customer: {
                salon_name: invoice.salon_name,
                address: [salon.address, salon.address_line2].filter(Boolean).join(", ") || null,
                contact: salon.phone ?? null,
            },
            seller: {
                name: "Salonox Tech",
                address: "F01, A/P Nimboti Tal. Baramati Dist. Pune",
                contact: "7875914818",
                email: "avinashjgpt10@gmail.com",
                gst_number: "27ASPPJ5781N1ZT",
                pan: "ASPPJ5781N",
                bank_name: "Punjab National Bank",
                bank_branch: "Baramati",
                bank_account_number: "0705102100002626",
                bank_ifsc: "PUNB0070510",
                bank_account_type: "Current",
            },
            amount_in_words: amountInWords(totalAmount),
        };
    },

    async getInvoiceForPrint(id: string) {
        return this._buildPrintPayload(id);
    },

    // Best-effort — a mail-server hiccup or missing owner email must never
    // fail invoice creation itself, so the caller (createInvoice) fires
    // this without awaiting it and catches any error into a log line only.
    async _emailInvoiceToSalonOwner(invoiceId: string) {
        const payload = await this._buildPrintPayload(invoiceId);
        const owner = await superAdminRepository.getSalonOwnerContact(payload.invoice.salon_id);
        if (!owner?.owner_email) {
            logger.warn(`Skipped invoice email — no owner email on file for salon ${payload.invoice.salon_id}`);
            return;
        }

        const pdfBuffer = await renderSalonPlanInvoicePdf(payload);
        await emailService.sendSalonPlanInvoiceEmail({
            to: owner.owner_email,
            salonName: payload.customer.salon_name,
            invoiceNo: payload.invoice.invoice_no || payload.invoice.invoice_number,
            planLabel: payload.invoice.plan_label,
            amount: Number(payload.invoice.amount),
            dueDate: payload.invoice.due_date,
            pdfBuffer,
            pdfFilename: `${(payload.invoice.invoice_no || payload.invoice.invoice_number).replace(/\//g, "-")}.pdf`,
        });
    },
};
