import { whatsappMetaApi } from "../marketing/whatsapp/shared/whatsapp.api";

// The OTP goes out from SalonOx's OWN Meta account (the platform salon's
// WhatsApp config, set up in Super Admin), not from the salon's number. A
// client may not have messaged that number in the last 24h, so free text is not
// an option - Meta requires an approved AUTHENTICATION template.
// Created by hand in Super Meta > Templates (nothing is submitted from code). Name / language can be overridden with env vars
// if it was created under a different name.
export const REDEEM_OTP_TEMPLATE_NAME = process.env.REDEEM_OTP_TEMPLATE_NAME || "salonox_redeem_otp";
export const REDEEM_OTP_TEMPLATE_LANG = process.env.REDEEM_OTP_TEMPLATE_LANG || "en";
export const REDEEM_OTP_EXPIRY_MINUTES = 10;

// Meta's authentication-template shape: fixed body text (Meta writes it),
// security-recommendation line, expiry footer and a copy-code button.
export function buildOtpTemplateComponents(): any[] {
  return [
    { type: "BODY", add_security_recommendation: true },
    { type: "FOOTER", code_expiration_minutes: REDEEM_OTP_EXPIRY_MINUTES },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
  ];
}

export async function submitOtpTemplate(wabaId: string, accessToken: string) {
  return whatsappMetaApi.submitTemplate({
    wabaId,
    accessToken,
    name: REDEEM_OTP_TEMPLATE_NAME,
    category: "AUTHENTICATION",
    language: REDEEM_OTP_TEMPLATE_LANG,
    components: buildOtpTemplateComponents(),
  });
}

// Send-time components: the code fills the body {{1}} AND the copy-code button.
export function sendOtpTemplate(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  code: string;
}) {
  return whatsappMetaApi.sendTemplateMessage({
    phoneNumberId: params.phoneNumberId,
    accessToken: params.accessToken,
    to: params.to,
    templateName: REDEEM_OTP_TEMPLATE_NAME,
    language: REDEEM_OTP_TEMPLATE_LANG,
    components: [
      { type: "body", parameters: [{ type: "text", text: params.code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: params.code }] },
    ],
  });
}
