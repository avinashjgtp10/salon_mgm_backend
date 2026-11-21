import { AppError } from "../../middleware/error.middleware";
import { configRepository } from "../marketing/whatsapp/config/config.repository";
import { whatsappMetaApi } from "../marketing/whatsapp/shared/whatsapp.api";
import { REDEEM_OTP_TEMPLATE_NAME, REDEEM_OTP_TEMPLATE_LANG, submitOtpTemplate } from "../redemption-otp/redemption-otp.template";
import { getPlatformSalonId } from "./platform-salon";

// Super Meta > Automated Messages: the redemption OTP message. Its wording is fixed by Meta (an Authentication template),
// so unlike the other messages there is nothing to edit here, only its status on Meta and a Submit button.

export type OtpTemplateInfo = {
    name: string;
    language: string;
    status: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED" | string;
    rejectedReason: string | null;
};

async function platformConfig() {
    const salonId = await getPlatformSalonId();
    const cfg = salonId ? await configRepository.findBySalonId(salonId) : null;
    if (!cfg?.waba_id || !cfg?.access_token) {
        throw new AppError(409, "Connect the SalonOx WhatsApp number under Super Meta > Configuration first.", "PLATFORM_WHATSAPP_NOT_CONFIGURED");
    }
    return cfg;
}

const toInfo = (t?: { status?: string; rejected_reason?: string }): OtpTemplateInfo => ({
    name: REDEEM_OTP_TEMPLATE_NAME,
    language: REDEEM_OTP_TEMPLATE_LANG,
    status: t?.status ?? "NOT_SUBMITTED",
    rejectedReason: t?.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
});

async function lookup(cfg: { waba_id: string; access_token: string }) {
    const found = await whatsappMetaApi.findTemplatesByName(cfg.waba_id, cfg.access_token, REDEEM_OTP_TEMPLATE_NAME);
    return found.find((t) => t.language === REDEEM_OTP_TEMPLATE_LANG) ?? found[0];
}

export const platformOtpTemplate = {
    async status(): Promise<OtpTemplateInfo> {
        const cfg = await platformConfig();
        return toInfo(await lookup(cfg));
    },

    async submit(): Promise<OtpTemplateInfo> {
        const cfg = await platformConfig();
        const existing = await lookup(cfg);
        // Already on Meta (any state): never submit a duplicate, just report where it stands.
        if (existing) return toInfo(existing);
        try {
            await submitOtpTemplate(cfg.waba_id, cfg.access_token);
        } catch (err: any) {
            throw new AppError(502, err?.response?.data?.error?.error_user_msg ?? err?.response?.data?.error?.message ?? "Meta rejected the template submission", "META_SUBMIT_FAILED");
        }
        return toInfo(await lookup(cfg).catch(() => ({ status: "PENDING" })));
    },
};
