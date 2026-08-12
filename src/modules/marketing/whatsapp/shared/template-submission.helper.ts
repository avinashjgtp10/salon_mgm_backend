import { AppError } from "../../../../middleware/error.middleware";
import { configRepository } from "../config/config.repository";
import { whatsappMetaApi } from "./whatsapp.api";

// Same extraction used by templates.service.ts's own body-component builder —
// kept as a standalone copy here rather than importing from that file, so
// this new purchase-template flow can't regress the already-working
// marketing-campaign template feature by sharing mutable state/imports.
function extractExamples(text: string): string[] {
    const matches = text.match(/{{\d+}}/g) ?? [];
    // Dedupe to unique variable numbers — Meta wants ONE example per distinct
    // variable, so a body that repeats {{1}} must not yield two example entries
    // (a count mismatch Meta rejects, or surfaces later as send error 132012).
    const unique = [...new Set(matches.map((m) => parseInt(m.replace(/[{}]/g, ""), 10)))];
    return unique
        .sort((a, b) => a - b)
        .map((n) => `Example${n}`);
}

// Purchase-automation templates are body-only by default (no header/footer) —
// matches "predefined wording, edit the wording" and keeps the salon-owner UI
// simple, unlike the full-featured marketing campaign template builder. The
// one exception is an optional single CTA-URL button (e.g. review_request's
// "Rate Your Visit" link) — still far short of the campaign builder's full
// header/footer/multi-button support, so the name stays accurate in spirit.
export async function submitBodyOnlyTemplate(params: {
    salonId: string;
    name: string;
    category: "UTILITY" | "MARKETING";
    language: string;
    bodyText: string;
    button?: { text: string; urlBase: string };
}): Promise<{ metaTemplateId?: string; status: string }> {
    const config = await configRepository.findBySalonId(params.salonId);
    if (!config) throw new AppError(400, "WhatsApp not configured for this salon", "WA_NOT_CONFIGURED");

    const bodyExamples = extractExamples(params.bodyText);
    const bodyComponent: any = { type: "BODY", text: params.bodyText };
    if (bodyExamples.length > 0) bodyComponent.example = { body_text: [bodyExamples] };

    const components: any[] = [bodyComponent];

    // Meta requires the create-time URL to end in a {{1}} placeholder (with an
    // example suffix) whenever the send-time payload will supply a
    // per-recipient dynamic suffix via a button/url component (see
    // whatsapp-automation.service.ts's buildComponents()).
    if (params.button) {
        components.push({
            type: "BUTTONS",
            buttons: [{
                type: "URL",
                text: params.button.text,
                url: `${params.button.urlBase}/{{1}}`,
                example: [`${params.button.urlBase}/sample-token`],
            }],
        });
    }

    const meta = await whatsappMetaApi.submitTemplate({
        wabaId: config.waba_id,
        accessToken: config.access_token,
        name: params.name,
        category: params.category,
        language: params.language,
        components,
    });

    return { metaTemplateId: meta.id, status: meta.status ?? "PENDING" };
}

export async function syncBodyOnlyTemplateStatus(params: {
    salonId: string;
    metaTemplateId: string;
}): Promise<{ status: "PENDING" | "APPROVED" | "REJECTED"; rejectionReason: string | null }> {
    const config = await configRepository.findBySalonId(params.salonId);
    if (!config) return { status: "PENDING", rejectionReason: null };

    const meta = await whatsappMetaApi.getTemplateStatus(config.access_token, params.metaTemplateId);
    return { status: meta.status, rejectionReason: meta.rejected_reason ?? null };
}
