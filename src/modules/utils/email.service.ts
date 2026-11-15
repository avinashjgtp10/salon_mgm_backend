import nodemailer from "nodemailer";
import config from "../../config/env";
import { formatMoney, dateLocale } from "../../config/currency";
import { translator } from "../../config/i18n";
import { DEFAULT_LANGUAGE, getSalonLanguage, languageDateLocale, languageDir, normalizeLanguage } from "../../config/language";

export const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false, // 587
  auth: {
    user: config.smtp.user,
    pass: config.smtp.pass,
  },
  requireTLS: true,
});

// Payment / invoice / expiry-reminder mail. Gmail (and most SMTP providers) only let an account send as its own address, so to
// really send from the billing address (EMAIL_FROM_BILLING) give it its own login via SMTP_BILLING_USER / SMTP_BILLING_PASS.
// Without them the main account is used, and the provider may replace the From address with that account's own.
export const billingTransporter = config.smtp.billingUser && config.smtp.billingPass
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
      auth: { user: config.smtp.billingUser, pass: config.smtp.billingPass },
      requireTLS: true,
    })
  : transporter;

/**
 * The language an email is written in: an explicit one (what the person's screen shows when nothing is known about a salon yet —
 * registration, forgotten password), else the salon's own (salons.language), else English. English output is unchanged.
 */
async function emailLanguage(p: { language?: string | null; salonId?: string | null }): Promise<string> {
  if (p.language) return normalizeLanguage(p.language);
  return p.salonId ? getSalonLanguage(p.salonId) : DEFAULT_LANGUAGE;
}

/** lang/dir for the <html> tag. Only right-to-left languages get a dir, so English output stays as it was. */
const htmlAttrs = (lang: string) => `lang="${lang}"${languageDir(lang) === "rtl" ? ' dir="rtl"' : ""}`;
/** dir for <body> or a root <div> (some mail clients ignore the one on <html>). */
const bodyDir = (lang: string) => (languageDir(lang) === "rtl" ? ' dir="rtl"' : "");

const escapeHtml = (value: string | null | undefined) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatDateTime = (value: string | undefined) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleString(dateLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
};

// Shared branded shell for the Client Requirements email family
// (sendRequirementCreatedEmail / sendRequirementAssignedEmail /
// sendRequirementStatusChangedEmail / sendRequirementUpdateEmail /
// sendRequirementCompletedEmail) — a consistent logo mark + header band +
// footer around each one's own body content, instead of each template
// hand-rolling its own header/footer markup with slightly different
// spacing/colors.
const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  high: { bg: "#fef2f2", text: "#dc2626" },
  medium: { bg: "#fffbeb", text: "#d97706" },
  low: { bg: "#f0fdf4", text: "#16a34a" },
};

function priorityBadgeHtml(priority: string): string {
  const c = PRIORITY_COLORS[priority.toLowerCase()] ?? { bg: "#f1f5f9", text: "#475569" };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};color:${c.text};font-size:11px;font-weight:700;text-transform:capitalize;letter-spacing:0.02em;">${escapeHtml(priority)}</span>`;
}

function requirementEmailShell(params: {
  eyebrow: string;
  heading: string;
  accentColor: string;
  bodyHtml: string;
}): string {
  const { eyebrow, heading, accentColor, bodyHtml } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06),0 8px 24px rgba(15,23,42,0.06);max-width:580px;width:100%;">

        <!-- Brand strip -->
        <tr><td style="padding:24px 36px 0;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#6366f1,#8b5cf6);text-align:center;vertical-align:middle;font-size:15px;">
              <span style="color:#fff;font-weight:800;font-family:Arial,sans-serif;">S</span>
            </td>
            <td style="padding-left:10px;color:#0f172a;font-size:15px;font-weight:800;letter-spacing:-0.01em;">SalonoX</td>
          </tr></table>
        </td></tr>

        <!-- Header band -->
        <tr><td style="padding:20px 36px 26px;">
          <p style="margin:0 0 6px;color:${accentColor};font-size:11.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0;color:#0f172a;font-size:21px;font-weight:800;line-height:1.3;">${heading}</h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:0 36px 32px;">
          ${bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #eef2f6;">
          <p style="margin:0;color:#94a3b8;font-size:11.5px;text-align:center;">This is an automated notification from SalonoX — please do not reply directly to this email.</p>
          <p style="margin:6px 0 0;color:#cbd5e1;font-size:11px;text-align:center;">© ${new Date().getFullYear()} SalonoX. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

// A bordered key/value info card — the requirement summary block reused
// across every template in this family.
function infoCardHtml(rows: [string, string][], accentBg = "#f8fafc", accentBorder = "#eef2f6"): string {
  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:7px 0;color:#64748b;font-size:12.5px;font-weight:600;vertical-align:top;width:130px;">${escapeHtml(label)}</td>
      <td style="padding:7px 0;color:#0f172a;font-size:13px;font-weight:600;vertical-align:top;">${value}</td>
    </tr>`).join("");
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${accentBg};border:1px solid ${accentBorder};border-radius:12px;">
      <tr><td style="padding:18px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
      </td></tr>
    </table>`;
}

export const emailService = {
  async verifyConnection() {
    await transporter.verify();
  },

  async sendOtpEmail(email: string, otp: string, options: { language?: string | null; salonId?: string | null } = {}) {
    const lang = await emailLanguage(options);
    const t = translator(lang);
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: t("email.otp.subject"),
      html: `
        <div${bodyDir(lang)} style="font-family: Arial, sans-serif">
          <h2>${t("email.otp.title")}</h2>
          <p>${t("email.otp.intro")}</p>
          <h1 style="letter-spacing: 4px;">${otp}</h1>
          <p>${t("email.otp.expiry", { minutes: config.otp.expMinutes })}</p>
        </div>
      `,
    });
  },

  // Sent to the fixed approver mailbox when a super admin is about to change a
  // salon's WhatsApp credentials (see config-otp.service.ts).
  async sendWhatsAppConfigOtpEmail(email: string, otp: string, salonId: string) {
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: "SalonOx - OTP to change WhatsApp credentials",
      html: `
        <div style="font-family: Arial, sans-serif">
          <h2>WhatsApp credentials change</h2>
          <p>A change to a salon's WhatsApp connection was requested in Super Admin.</p>
          <p style="color:#666">Salon ID: ${salonId}</p>
          <p>Your one-time code is:</p>
          <h1 style="letter-spacing: 4px;">${otp}</h1>
          <p>It expires in 10 minutes. If you did not request this, ignore this email and do not share the code.</p>
        </div>
      `,
    });
  },

  async sendPasswordResetOtpEmail(email: string, otp: string, options: { language?: string | null; salonId?: string | null } = {}) {
    const lang = await emailLanguage(options);
    const t = translator(lang);
    await transporter.sendMail({
      from: config.smtp.from,
      to: email,
      subject: t("email.resetOtp.subject"),
      html: `
        <div${bodyDir(lang)} style="font-family: Arial, sans-serif, max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">${t("email.resetOtp.title")}</h2>
          <p style="color: #666; font-size: 16px;">${t("email.resetOtp.intro")}</p>
          <div style="background-color: #f4f4f7; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="letter-spacing: 6px; color: #6366f1; margin: 0; font-size: 32px;">${otp}</h1>
          </div>
          <p style="color: #666; font-size: 14px;">${t("email.resetOtp.expiry", { minutes: config.otp.expMinutes })}</p>
        </div>
      `,
    });
  },

  async sendPasswordResetConfirmationEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    fullName: string;
    resetAt: Date;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, fullName, resetAt } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const dateLoc = languageDateLocale(lang) ?? "en-US";
    const formattedDate = resetAt.toLocaleDateString(dateLoc, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const formattedTime = resetAt.toLocaleTimeString(dateLoc, {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.resetDone.subject"),
      html: `
        <!DOCTYPE html>
        <html ${htmlAttrs(lang)}>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${t("email.resetDone.title")}</title>
        </head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:10px;overflow:hidden;
                         box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:560px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:36px 40px;text-align:center;">
                      <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
                        SalonOx
                      </h1>
                      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                        ${t("email.resetDone.title")}
                      </p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px 40px 24px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        ${t("email.common.hiBold", { name: fullName })}
                      </p>
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        ${t("email.resetDone.body")}
                      </p>

                      <!-- Reset Details Box -->
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin:24px 0;">
                        <tr>
                          <td style="padding:20px 24px;">
                            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;
                                      letter-spacing:0.05em;font-weight:600;">
                              ${t("email.resetDone.details")}
                            </p>
                            <p style="margin:0 0 4px;color:#374151;font-size:14px;">
                              <strong>${t("email.label.date")}:</strong> ${formattedDate}
                            </p>
                            <p style="margin:0;color:#374151;font-size:14px;">
                              <strong>${t("email.label.time")}:</strong> ${formattedTime}
                            </p>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:0 0 32px;color:#374151;font-size:15px;line-height:1.6;">
                        ${t("email.resetDone.loginNote")}
                      </p>

                      <!-- CTA Button -->
                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${loginUrl}"
                               style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;
                                      padding:14px 48px;border-radius:8px;
                                      box-shadow:0 4px 12px rgba(99,102,241,0.4);">
                              ${t("email.resetDone.loginButton")}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Security Notice -->
                  <tr>
                    <td style="padding:24px 40px;">
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#fef3c7;border-radius:8px;border:1px solid #fcd34d;">
                        <tr>
                          <td style="padding:16px 20px;">
                            <p style="margin:0 0 8px;color:#92400e;font-size:14px;font-weight:600;">
                              ${t("email.resetDone.securityTitle")}
                            </p>
                            <p style="margin:0 0 6px;color:#92400e;font-size:13px;line-height:1.6;">
                              ${t("email.resetDone.securityBody")}
                            </p>
                            <p style="margin:0;color:#92400e;font-size:13px;">
                              ${t("email.resetDone.support")} <a href="mailto:support@salonox.com" style="color:#6366f1;">support@salonox.com</a>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 6px;color:#9ca3af;font-size:12px;text-align:center;">
                        ${t("email.common.rights", { year: new Date().getFullYear() })}
                      </p>
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                        ${t("email.resetDone.footerAuto")}
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendWelcomeEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    fullName: string;
    salonName: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, fullName, salonName } = params;
    const frontendUrl = config.frontend.url;
    const loginUrl = `${frontendUrl}/login`;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.welcome.subject", { name: fullName }),
      html: `
        <!DOCTYPE html>
        <html ${htmlAttrs(lang)}>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${t("email.welcome.pageTitle")}</title>
        </head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="580" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;
                         box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:580px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:40px 40px 32px;text-align:center;">
                      <h1 style="margin:0 0 4px;color:#ffffff;font-size:28px;font-weight:800;
                                 letter-spacing:-0.5px;">
                        SalonOx
                      </h1>
                      <p style="margin:0;color:rgba(255,255,255,0.80);font-size:13px;
                                letter-spacing:2px;text-transform:uppercase;">
                        ${t("email.welcome.tagline")}
                      </p>
                    </td>
                  </tr>

                  <!-- Welcome Banner -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:0 40px 40px;text-align:center;">
                      <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:20px 24px;">
                        <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">
                          ${t("email.welcome.banner", { name: fullName })}
                        </p>
                        <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">
                          ${t("email.welcome.bannerSub")}
                        </p>
                      </div>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:36px 40px 28px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.7;">
                        ${t("email.common.hiBold", { name: fullName })}
                      </p>
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.7;">
                        ${t("email.welcome.intro", { salon: salonName })}
                      </p>
                      <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.7;">
                        ${t("email.welcome.about")}
                      </p>

                      <!-- Login Details -->
                      <div style="background:#f9fafb;border-radius:10px;padding:20px 28px;margin-bottom:24px;">
                        <p style="margin:0 0 10px;color:#374151;font-size:15px;font-weight:700;">
                          Your Login Details
                        </p>
                        <p style="margin:0 0 6px;color:#374151;font-size:14px;line-height:1.6;">
                          <span style="color:#6b7280;">Registered Email:</span>
                          <strong>${to}</strong>
                        </p>
                        <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
                          <span style="color:#6b7280;">Password:</span>
                          Use the password you set during sign-up. For your security, we never send passwords by email.
                          Forgot it? <a href="${frontendUrl}/forgot-password" style="color:#6366f1;text-decoration:underline;">Reset your password</a>.
                        </p>
                      </div>

                      <!-- Login Button -->
                      <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
                        <tr>
                          <td align="center">
                            <a href="${loginUrl}"
                               style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;
                                      padding:14px 36px;border-radius:8px;">
                              Login to SalonOx
                            </a>
                          </td>
                        </tr>
                      </table>

                      <!-- Getting Started Steps -->
                      <div style="background:#f9fafb;border-radius:10px;padding:24px 28px;margin-bottom:28px;">
                        <p style="margin:0 0 16px;color:#374151;font-size:15px;font-weight:700;">
                          ${t("email.welcome.stepsTitle")}
                        </p>
                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="width:32px;vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                                          border-radius:50%;text-align:center;line-height:24px;
                                          color:#fff;font-size:12px;font-weight:700;">1</div>
                            </td>
                            <td style="padding-${languageDir(lang) === "rtl" ? "right" : "left"}:12px;padding-bottom:14px;">
                              <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                                ${t("email.welcome.step1")}
                              </p>
                              <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">
                                ${t("email.welcome.step1Body")}
                              </p>
                            </td>
                          </tr>
                          <tr>
                            <td style="width:32px;vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                                          border-radius:50%;text-align:center;line-height:24px;
                                          color:#fff;font-size:12px;font-weight:700;">2</div>
                            </td>
                            <td style="padding-${languageDir(lang) === "rtl" ? "right" : "left"}:12px;padding-bottom:14px;">
                              <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                                ${t("email.welcome.step2")}
                              </p>
                              <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">
                                ${t("email.welcome.step2Body")}
                              </p>
                            </td>
                          </tr>
                          <tr>
                            <td style="width:32px;vertical-align:top;padding-top:2px;">
                              <div style="width:24px;height:24px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                                          border-radius:50%;text-align:center;line-height:24px;
                                          color:#fff;font-size:12px;font-weight:700;">3</div>
                            </td>
                            <td style="padding-${languageDir(lang) === "rtl" ? "right" : "left"}:12px;">
                              <p style="margin:0;color:#374151;font-size:14px;font-weight:600;">
                                ${t("email.welcome.step3")}
                              </p>
                              <p style="margin:2px 0 0;color:#6b7280;font-size:13px;">
                                ${t("email.welcome.step3Body")}
                              </p>
                            </td>
                          </tr>
                        </table>
                      </div>

                      <!-- Support -->
                      <p style="margin:0 0 4px;color:#374151;font-size:15px;font-weight:700;">
                        Need help getting started?
                      </p>
                      <p style="margin:0 0 4px;color:#6b7280;font-size:14px;line-height:1.6;">
                        Our support team is here to help you.
                      </p>
                      <p style="margin:0;color:#374151;font-size:14px;">
                        Email:
                        <a href="mailto:support@salonox.com" style="color:#6366f1;text-decoration:underline;">support@salonox.com</a>
                      </p>

                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">
                        ${t("email.common.rights", { year: new Date().getFullYear() })}
                      </p>
                      <p style="margin:0;color:#d1d5db;font-size:11px;text-align:center;">
                        ${t("email.welcome.footer")}
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  // Daily reminder in the last days of a subscription that will not renew by itself (subscription-expiry-reminder.service).
  async sendSubscriptionExpiryReminderEmail(params: {
    to: string;
    ownerName?: string | null;
    salonName: string;
    planName: string;
    expiryDate: string;
    /** 0 = it expires today. */
    daysRemaining: number;
    subscriptionUrl: string;
  }) {
    const e = escapeHtml;
    const days = Math.max(0, Math.floor(params.daysRemaining));
    const when = days === 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;
    const detail = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;font-size:14px;width:46%;vertical-align:top;">${label}</td>
        <td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600;vertical-align:top;word-break:break-word;">${e(value)}</td>
      </tr>`;

    await billingTransporter.sendMail({
      from: config.smtp.billingFrom,
      to: params.to,
      subject: days === 0
        ? `Your SalonOx ${params.planName} subscription expires today`
        : `Your SalonOx ${params.planName} subscription expires ${when}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Subscription expiry reminder</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px;">
            <tr>
              <td align="center">
                <table width="580" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:580px;width:100%;">
                  <tr>
                    <td style="background:#f59e0b;background-image:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);padding:30px 32px;text-align:center;">
                      <p style="margin:0 0 6px;color:rgba(255,255,255,0.9);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">SalonOx</p>
                      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Subscription expiry reminder</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 32px 8px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">Hi ${e(params.ownerName?.trim() || "there")},</p>
                      <p style="margin:0 0 22px;color:#374151;font-size:16px;line-height:1.7;">
                        This is a friendly reminder that your SalonOx ${e(params.planName)} subscription is approaching its expiry date.
                      </p>
                      <p style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:700;">Subscription Details:</p>
                      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #eef2f6;border-radius:10px;padding:8px 18px;margin-bottom:22px;">
                        ${detail("Salon Name", params.salonName)}
                        ${detail("Current Plan", params.planName)}
                        ${detail("Expiry Date", params.expiryDate)}
                        ${detail("Days Remaining", String(days))}
                      </table>
                      <p style="margin:0 0 16px;color:#111827;font-size:16px;font-weight:700;line-height:1.6;">Your subscription will expire ${when}.</p>
                      <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">
                        To continue enjoying uninterrupted access to SalonOx features, please renew your subscription before the expiry date.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:4px 32px 12px;">
                      <a href="${e(params.subscriptionUrl)}"
                         style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
                        Renew Your Subscription
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:20px 32px 32px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">
                        Avoid interruptions to your salon operations, appointments, billing, reports, and other essential features.
                      </p>
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">Thank you for choosing SalonOx!</p>
                      <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Regards,<br /><strong>Team SalonOx</strong><br />
                        <a href="https://salonox.com" style="color:#6366f1;text-decoration:none;">https://salonox.com</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  // Sent once per verified subscription payment (see subscription-invoices.service emailInvoice) to an owner who has finished
  // onboarding: the payment details and the GST invoice PDF.
  async sendPaymentSuccessEmail(params: {
    to: string;
    ownerName?: string | null;
    salonName: string;
    planName: string;
    billingCycle: string;
    /** Already formatted with the payment's currency, e.g. "₹11,313.84". */
    amount: string;
    paymentId: string;
    paymentDate: string;
    startDate: string;
    endDate: string;
    pdfBuffer: Buffer;
    pdfFilename: string;
  }) {
    const loginUrl = `${config.frontend.url}/login`;
    const e = escapeHtml;
    const detail = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;font-size:14px;width:46%;vertical-align:top;">${label}</td>
        <td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600;vertical-align:top;word-break:break-word;">${e(value)}</td>
      </tr>`;
    // For an owner who has finished onboarding; one who hasn't gets sendPaymentReceivedOnboardingPendingEmail instead.
    const closing = `<p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">Your SalonOx account is ready. You can log in and start using all the features included in your subscription.</p>`;
    const ctaLabel = "Login Now";

    await billingTransporter.sendMail({
      from: config.smtp.billingFrom,
      to: params.to,
      subject: "Payment Successful – Your SalonOx Subscription is Active!",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Payment Successful</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px;">
            <tr>
              <td align="center">
                <table width="580" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:580px;width:100%;">
                  <tr>
                    <td style="background:#16a34a;background-image:linear-gradient(135deg,#16a34a 0%,#22c55e 100%);padding:32px;text-align:center;">
                      <p style="margin:0 0 6px;color:rgba(255,255,255,0.85);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">SalonOx</p>
                      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">Payment Successful</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 32px 8px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">Hi ${e(params.ownerName?.trim() || "there")},</p>
                      <p style="margin:0 0 22px;color:#374151;font-size:16px;line-height:1.7;">
                        Your payment has been successfully received. Thank you for choosing SalonOx!
                      </p>
                      <p style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:700;">Payment Details:</p>
                      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #eef2f6;border-radius:10px;padding:8px 18px;margin-bottom:22px;">
                        ${detail("Salon Name", params.salonName)}
                        ${detail("Plan", params.planName)}
                        ${detail("Billing Cycle", params.billingCycle)}
                        ${detail("Amount Paid", params.amount)}
                        ${detail("Payment ID", params.paymentId)}
                        ${detail("Payment Date", params.paymentDate)}
                        ${detail("Subscription Start Date", params.startDate)}
                        ${detail("Subscription End Date", params.endDate)}
                      </table>
                      <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">Your subscription payment has been confirmed successfully.</p>
                      <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.7;">
                        <strong>Invoice:</strong> Your official GST invoice is attached to this email for your records.
                      </p>
                      ${closing}
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:4px 32px 12px;">
                      <a href="${loginUrl}"
                         style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
                        ${ctaLabel}
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:20px 32px 32px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">Thank you for being a part of SalonOx!</p>
                      <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Regards,<br /><strong>Team SalonOx</strong><br />
                        <a href="https://salonox.in" style="color:#6366f1;text-decoration:none;">https://salonox.in</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      attachments: [{ filename: params.pdfFilename, content: params.pdfBuffer }],
    });
  },

  // The same verified payment, for an owner whose onboarding is NOT finished yet (they paid right after sign-up): confirms the
  // payment, attaches the invoice and sends them back to finish setting up.
  async sendPaymentReceivedOnboardingPendingEmail(params: {
    to: string;
    ownerName?: string | null;
    salonName: string;
    planName: string;
    /** Already formatted with the payment's currency, e.g. "₹11,313.84". */
    amount: string;
    paymentId: string;
    paymentDate: string;
    pdfBuffer: Buffer;
    pdfFilename: string;
  }) {
    const e = escapeHtml;
    const loginUrl = `${config.frontend.url}/login`;
    const detail = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;font-size:14px;width:46%;vertical-align:top;">${label}</td>
        <td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600;vertical-align:top;word-break:break-word;">${e(value)}</td>
      </tr>`;

    await billingTransporter.sendMail({
      from: config.smtp.billingFrom,
      to: params.to,
      subject: "Payment Received – Complete Your SalonOx Setup",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Payment received</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px;">
            <tr>
              <td align="center">
                <table width="580" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:580px;width:100%;">
                  <tr>
                    <td style="background:#16a34a;background-image:linear-gradient(135deg,#16a34a 0%,#22c55e 100%);padding:32px;text-align:center;">
                      <p style="margin:0 0 6px;color:rgba(255,255,255,0.85);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">SalonOx</p>
                      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">Payment Received</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 32px 8px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">Hi ${e(params.ownerName?.trim() || "there")},</p>
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">
                        <strong>Great news! Your SalonOx subscription payment has been successfully received.</strong>
                      </p>
                      <p style="margin:0 0 22px;color:#374151;font-size:16px;line-height:1.7;">
                        Your account has been created, and you are just one step away from getting started.
                      </p>
                      <p style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:700;">Payment Details:</p>
                      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #eef2f6;border-radius:10px;padding:8px 18px;margin-bottom:24px;">
                        ${detail("Salon Name", params.salonName)}
                        ${detail("Plan", params.planName)}
                        ${detail("Amount Paid", params.amount)}
                        ${detail("Payment ID", params.paymentId)}
                        ${detail("Payment Date", params.paymentDate)}
                      </table>

                      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:18px 20px;margin-bottom:22px;">
                        <p style="margin:0 0 8px;color:#92400e;font-size:16px;font-weight:800;">Complete Your Salon Setup</p>
                        <p style="margin:0 0 10px;color:#78350f;font-size:15px;line-height:1.7;">We noticed that your onboarding process is still incomplete.</p>
                        <p style="margin:0;color:#78350f;font-size:15px;line-height:1.7;">Please use the link below to log in and continue from where you left off.</p>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 32px 8px;">
                      <p style="margin:0 0 12px;color:#111827;font-size:15px;font-weight:700;">Continue Onboarding:</p>
                      <a href="${loginUrl}"
                         style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
                        Continue Onboarding
                      </a>
                      <p style="margin:12px 0 0;font-size:13px;color:#6b7280;word-break:break-all;">
                        <a href="${loginUrl}" style="color:#6366f1;text-decoration:none;">${loginUrl}</a>
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 32px 32px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">
                        Once you complete the onboarding process, you will be able to access your SalonOx dashboard and start managing your salon.
                      </p>
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">
                        Your payment invoice is attached to this email for your reference.
                      </p>
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">
                        If you need any assistance, feel free to contact our support team.
                      </p>
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">Welcome to SalonOx!</p>
                      <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Regards,<br /><strong>Team SalonOx</strong><br />
                        <a href="https://salonox.com" style="color:#6366f1;text-decoration:none;">https://salonox.com</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      attachments: [{ filename: params.pdfFilename, content: params.pdfBuffer }],
    });
  },

  // Sent once, when an owner has completed every mandatory onboarding step (salons.service completeOnboarding): the account
  // details and what they can do next. Not sent for registering or buying a plan on their own.
  async sendOnboardingCompleteEmail(params: {
    to: string;
    ownerName?: string | null;
    salonName: string;
    /** The salon's current plan; the two plan rows are left out when the salon has none yet. */
    planName?: string | null;
    /** Already formatted, e.g. "5 Nov 2027". */
    validUntil?: string | null;
  }) {
    const e = escapeHtml;
    const loginUrl = `${config.frontend.url}/login`;
    const detail = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;font-size:14px;width:46%;vertical-align:top;">${label}</td>
        <td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600;vertical-align:top;word-break:break-word;">${e(value)}</td>
      </tr>`;
    const features = [
      "Appointment &amp; Calendar Management",
      "Quick Sale &amp; Billing",
      "Client Management",
      "Staff Management",
      "Inventory Management",
      "Reports &amp; Analytics",
      "WhatsApp Marketing",
      "Online Booking",
    ];

    await transporter.sendMail({
      from: config.smtp.from,
      to: params.to,
      subject: "Congratulations! Your SalonOx Onboarding is Complete",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Your SalonOx onboarding is complete</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px;">
            <tr>
              <td align="center">
                <table width="580" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:580px;width:100%;">
                  <tr>
                    <td style="background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:34px 32px;text-align:center;">
                      <h1 style="margin:0 0 6px;color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.5px;">SalonOx</h1>
                      <p style="margin:0;color:rgba(255,255,255,0.9);font-size:16px;font-weight:600;">Your onboarding is complete</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 32px 8px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">Hi ${e(params.ownerName?.trim() || "there")},</p>
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">
                        <strong>Congratulations! Your SalonOx onboarding process has been successfully completed.</strong>
                      </p>
                      <p style="margin:0 0 22px;color:#374151;font-size:16px;line-height:1.7;">
                        Your salon account is now ready, and you can start managing your salon operations with SalonOx.
                      </p>
                      <p style="margin:0 0 8px;color:#111827;font-size:15px;font-weight:700;">Your Account Details:</p>
                      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #eef2f6;border-radius:10px;padding:8px 18px;margin-bottom:22px;">
                        ${detail("Salon Name", params.salonName)}
                        ${params.planName ? detail("Subscription Plan", params.planName) : ""}
                        ${detail("Account Email", params.to)}
                        ${params.validUntil ? detail("Subscription Valid Until", params.validUntil) : ""}
                      </table>
                      <p style="margin:0 0 10px;color:#374151;font-size:15px;line-height:1.7;">
                        You can now explore the features available in your subscription, including:
                      </p>
                      <ul style="margin:0 0 22px;padding-left:22px;color:#374151;font-size:15px;line-height:1.9;">
                        ${features.map((f) => `<li>${f}</li>`).join("")}
                      </ul>
                      <p style="margin:0 0 12px;color:#111827;font-size:15px;font-weight:700;">Access Your SalonOx Dashboard:</p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 32px 8px;">
                      <a href="${loginUrl}"
                         style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;">
                        Open Your Dashboard
                      </a>
                      <p style="margin:12px 0 0;font-size:13px;color:#6b7280;word-break:break-all;">
                        <a href="${loginUrl}" style="color:#6366f1;text-decoration:none;">${loginUrl}</a>
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:22px 32px 32px;">
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">
                        We're excited to help you simplify your salon operations and grow your business.
                      </p>
                      <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7;">Thank you for choosing SalonOx!</p>
                      <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">Regards,<br /><strong>Team SalonOx</strong><br />
                        <a href="https://salonox.com" style="color:#6366f1;text-decoration:none;">https://salonox.com</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendAccountCreatedEmail(params: {
    to: string;
    fullName: string;
    email: string;
    password: string;
    role: string;
  }) {
    const { to, fullName, email, password, role } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const roleLabel = role === "salon_owner" ? "Salon Owner" : role.charAt(0).toUpperCase() + role.slice(1);

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: "Your SalonOx Account Has Been Created",
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Account Created – SalonOx</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:12px;overflow:hidden;
                         box-shadow:0 4px 24px rgba(0,0,0,0.09);max-width:560px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:36px 40px 28px;text-align:center;">
                      <h1 style="margin:0 0 4px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">SalonOx</h1>
                      <p style="margin:0;color:rgba(255,255,255,0.82);font-size:13px;letter-spacing:1.5px;text-transform:uppercase;">Account Created by Admin</p>
                    </td>
                  </tr>

                  <!-- Greeting -->
                  <tr>
                    <td style="padding:36px 40px 0;">
                      <p style="margin:0 0 14px;color:#374151;font-size:16px;line-height:1.7;">
                        Hi <strong>${fullName}</strong>,
                      </p>
                      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.7;">
                        A <strong>SalonOx</strong> account has been created for you by the platform administrator.
                        You can log in immediately using the credentials below.
                      </p>
                    </td>
                  </tr>

                  <!-- Credentials Box -->
                  <tr>
                    <td style="padding:0 40px 28px;">
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#f5f3ff;border-radius:10px;border:1.5px solid #ede9fe;">
                        <tr>
                          <td style="padding:24px 28px;">
                            <p style="margin:0 0 16px;color:#6d28d9;font-size:12px;font-weight:700;
                                      text-transform:uppercase;letter-spacing:0.08em;">
                              Your Login Credentials
                            </p>

                            <table cellpadding="0" cellspacing="0" width="100%">
                              <tr>
                                <td style="padding-bottom:12px;">
                                  <p style="margin:0 0 3px;color:#7c3aed;font-size:11px;font-weight:600;text-transform:uppercase;">Role</p>
                                  <p style="margin:0;color:#1f2937;font-size:15px;font-weight:600;">${roleLabel}</p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding-bottom:12px;border-top:1px solid #ede9fe;padding-top:12px;">
                                  <p style="margin:0 0 3px;color:#7c3aed;font-size:11px;font-weight:600;text-transform:uppercase;">Email Address</p>
                                  <p style="margin:0;color:#1f2937;font-size:15px;font-weight:600;">${email}</p>
                                </td>
                              </tr>
                              <tr>
                                <td style="border-top:1px solid #ede9fe;padding-top:12px;">
                                  <p style="margin:0 0 3px;color:#7c3aed;font-size:11px;font-weight:600;text-transform:uppercase;">Password</p>
                                  <p style="margin:0;background:#ede9fe;border-radius:6px;padding:8px 14px;
                                            color:#1f2937;font-size:17px;font-weight:700;letter-spacing:2px;
                                            font-family:monospace;">${password}</p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- CTA -->
                  <tr>
                    <td style="padding:0 40px 32px;">
                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${loginUrl}"
                               style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;
                                      padding:14px 48px;border-radius:8px;
                                      box-shadow:0 4px 14px rgba(99,102,241,0.45);">
                              Login to Your Account
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Security Notice -->
                  <tr>
                    <td style="padding:0 40px 28px;">
                      <table cellpadding="0" cellspacing="0" width="100%"
                        style="background:#fffbeb;border-radius:8px;border:1px solid #fcd34d;">
                        <tr>
                          <td style="padding:14px 18px;">
                            <p style="margin:0 0 5px;color:#92400e;font-size:13px;font-weight:700;">
                              Important – Change your password after first login
                            </p>
                            <p style="margin:0;color:#92400e;font-size:12px;line-height:1.6;">
                              For your security, please update your password as soon as you log in for the first time.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">
                        &copy; ${new Date().getFullYear()} SalonOx. All rights reserved.
                      </p>
                      <p style="margin:0;color:#d1d5db;font-size:11px;text-align:center;">
                        This account was created by a platform administrator. If you did not expect this, please contact support.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendSupportTicketCreatedEmail(params: {
    ticketId: string;
    subject: string;
    category?: string | null;
    message: string;
    priority: string;
    salonName?: string | null;
    submitterName?: string | null;
    submitterEmail?: string | null;
    createdAt?: string;
  }) {
    const supportRecipient =
      process.env.SUPPORT_NOTIFICATION_EMAIL || config.smtp.user || config.smtp.from;
    const adminUrl = `${config.frontend.url}/super-admin/support`;
    const priority = params.priority || "medium";
    const priorityColor =
      priority === "high" ? "#dc2626" : priority === "low" ? "#059669" : "#d97706";

    await transporter.sendMail({
      from: config.smtp.from,
      to: supportRecipient,
      subject: `[SalonOx Support] ${priority.toUpperCase()} - ${params.subject}`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>New Support Ticket</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">
                  <tr>
                    <td style="background:#111827;padding:28px 32px;">
                      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">New Support Ticket</h1>
                      <p style="margin:8px 0 0;color:#cbd5e1;font-size:13px;">A salon user raised a support request.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px 32px;">
                      <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:0.08em;">Subject</p>
                      <h2 style="margin:0 0 20px;color:#111827;font-size:19px;line-height:1.35;">${escapeHtml(params.subject)}</h2>

                      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:20px;">
                        <tr>
                          <td style="padding:16px 18px;">
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Ticket ID:</strong> ${escapeHtml(params.ticketId)}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Salon:</strong> ${escapeHtml(params.salonName || "Unknown")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Submitted by:</strong> ${escapeHtml(params.submitterName || "Unknown")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Email:</strong> ${escapeHtml(params.submitterEmail || "Not available")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Category:</strong> ${escapeHtml(params.category || "general")}</p>
                            <p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>Created:</strong> ${formatDateTime(params.createdAt)}</p>
                            <p style="margin:0;color:#374151;font-size:14px;"><strong>Priority:</strong> <span style="color:${priorityColor};font-weight:700;text-transform:capitalize;">${escapeHtml(priority)}</span></p>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;letter-spacing:0.08em;">Message</p>
                      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin-bottom:24px;color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(params.message)}</div>

                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${adminUrl}"
                               style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">
                              Open Support Dashboard
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">This notification was sent by SalonOx automatically.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  // ── Business Event Notifications ─────────────────────────────────────────────

  async sendNewAppointmentEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    salonName: string;
    clientName: string;
    services: string;
    date: string;
    time: string;
    appointmentId: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, salonName, clientName, services, date, time, appointmentId } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.newAppointment.subject", { name: clientName }),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#111827;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${salonName}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.newAppointment.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.newAppointment.intro")}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 12px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${t("email.newAppointment.details")}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.client")}:</strong> ${escapeHtml(clientName)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.service")}:</strong> ${escapeHtml(services)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.date")}:</strong> ${escapeHtml(date)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.time")}:</strong> ${escapeHtml(time)}</p>
                          <p style="margin:0;color:#6b7280;font-size:12px;">${t("email.common.ref", { ref: escapeHtml(appointmentId.slice(0, 8).toUpperCase()) })}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendAppointmentCancelledEmail(params: {
    to: string;
    clientName: string;
    salonName: string;
    date: string;
    time: string;
  }) {
    const { to, clientName, salonName, date, time } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Your Appointment has been Cancelled — ${salonName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#dc2626;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Appointment Cancelled</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(clientName)}</strong>, your appointment at <strong>${escapeHtml(salonName)}</strong> has been cancelled.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>Date:</strong> ${escapeHtml(date)}</p>
                          <p style="margin:0;color:#991b1b;font-size:14px;"><strong>Time:</strong> ${escapeHtml(time)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      Please contact us if you'd like to rebook or if you have any questions.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendAppointmentCancelledOwnerEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    salonName: string;
    clientName: string;
    date: string;
    time: string;
    appointmentId: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, salonName, clientName, date, time, appointmentId } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.cancelledOwner.subject", { name: clientName }),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#dc2626;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.cancelledOwner.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.cancelledOwner.intro")}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>${t("email.label.client")}:</strong> ${escapeHtml(clientName)}</p>
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>${t("email.label.date")}:</strong> ${escapeHtml(date)}</p>
                          <p style="margin:0 0 8px;color:#991b1b;font-size:14px;"><strong>${t("email.label.time")}:</strong> ${escapeHtml(time)}</p>
                          <p style="margin:0;color:#991b1b;font-size:12px;">${t("email.common.ref", { ref: escapeHtml(appointmentId.slice(0, 8).toUpperCase()) })}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendAppointmentCompletedEmail(params: {
    to: string;
    clientName: string;
    salonName: string;
    services: string;
    amount: string;
    /** The salon's currency (salons.currency) — the amount is printed in it. */
    currency?: string | null;
  }) {
    const { to, clientName, salonName, services, amount, currency } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Your Appointment Receipt — ${salonName}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#16a34a;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Thank You for Your Visit!</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(clientName)}</strong>, thank you for visiting <strong>${escapeHtml(salonName)}</strong>. Here's your receipt:
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#15803d;font-size:14px;"><strong>Services:</strong> ${escapeHtml(services)}</p>
                          <p style="margin:0;color:#15803d;font-size:16px;font-weight:700;"><strong>Total:</strong> ${escapeHtml(formatMoney(amount, currency))}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      We hope to see you again soon!
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendNewPaymentEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    salonName: string;
    clientName: string;
    amount: string;
    /** The salon's currency (salons.currency) — the amount is printed in it. */
    currency?: string | null;
    paymentMethod: string;
    invoiceId: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, salonName, clientName, amount, currency, paymentMethod, invoiceId } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.newPayment.subject", { amount: formatMoney(amount, currency) }),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#111827;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.newPayment.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.newPayment.intro", { client: escapeHtml(clientName) })}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.client")}:</strong> ${escapeHtml(clientName)}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:800;color:#16a34a;">${escapeHtml(formatMoney(amount, currency))}</p>
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.method")}:</strong> ${escapeHtml(paymentMethod)}</p>
                          <p style="margin:0;color:#6b7280;font-size:12px;">${t("email.newPayment.invoice", { id: escapeHtml(invoiceId) })}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendNewClientEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    salonName: string;
    clientName: string;
    clientEmail?: string;
    clientPhone?: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, salonName, clientName, clientEmail, clientPhone } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.newClient.subject", { name: clientName }),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#111827;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.newClient.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.newClient.intro", { salon: escapeHtml(salonName) })}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.name")}:</strong> ${escapeHtml(clientName)}</p>
                          ${clientEmail ? `<p style="margin:0 0 8px;color:#111827;font-size:14px;"><strong>${t("email.label.email")}:</strong> ${escapeHtml(clientEmail)}</p>` : ""}
                          ${clientPhone ? `<p style="margin:0;color:#111827;font-size:14px;"><strong>${t("email.label.phone")}:</strong> ${escapeHtml(clientPhone)}</p>` : ""}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendStaffLoginEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    salonName: string;
    staffName: string;
    staffEmail: string;
    loginTime: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, salonName, staffName, staffEmail, loginTime } = params;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.staffLogin.subject", { name: staffName }),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#1e40af;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.7;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.staffLogin.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.staffLogin.intro", { salon: escapeHtml(salonName) })}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#1e40af;font-size:14px;"><strong>${t("email.label.name")}:</strong> ${escapeHtml(staffName)}</p>
                          <p style="margin:0 0 8px;color:#1e40af;font-size:14px;"><strong>${t("email.label.email")}:</strong> ${escapeHtml(staffEmail)}</p>
                          <p style="margin:0;color:#1e40af;font-size:14px;"><strong>${t("email.label.time")}:</strong> ${escapeHtml(loginTime)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      ${t("email.staffLogin.note")}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  // Sent both the moment super admin deactivates a salon
  // (super-admin.service.ts::setSalonStatus) and daily at 8am IST as a
  // reminder for any salon still deactivated (salon-deactivation-reminder.scheduler.ts).
  async sendSalonDeactivatedEmail(params: { to: string; salonName: string; ownerName?: string | null; /** Recipient's salon — its language is used. */ salonId?: string | null; language?: string | null }) {
    const { to, salonName, ownerName } = params;
    const lang = await emailLanguage(params);
    const t = translator(lang);
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.deactivated.subject"),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#dc2626;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.deactivated.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.deactivated.body", { greeting: ownerName ? t("email.common.hiName", { name: escapeHtml(ownerName) }) : t("email.common.hiPlain") })}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#fef2f2;border-radius:10px;border:1px solid #fecaca;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0;color:#991b1b;font-size:14px;"><strong>${t("email.label.salon")}:</strong> ${escapeHtml(salonName)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                      ${t("email.deactivated.note")}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendStaffInvitation(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    token: string;
    staffFirstName: string;
    salonName: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, token, staffFirstName, salonName } = params;
    const inviteLink = `${config.frontend.url}/accept-invite?token=${token}`;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.staffInvite.subject", { salon: salonName }),
      html: `
        <!DOCTYPE html>
        <html ${htmlAttrs(lang)}>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${t("email.staffInvite.title")}</title>
        </head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0"
                  style="background:#ffffff;border-radius:10px;overflow:hidden;
                         box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:560px;width:100%;">

                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                               padding:36px 40px;text-align:center;">
                      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;
                                 letter-spacing:-0.5px;">
                        ${salonName}
                      </h1>
                      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                        ${t("email.staffInvite.title")}
                      </p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px 40px 32px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        ${t("email.common.hiBold", { name: staffFirstName })}
                      </p>
                      <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">
                        ${t("email.staffInvite.body", { salon: salonName })}
                      </p>
                      <p style="margin:0 0 32px;color:#6b7280;font-size:14px;line-height:1.6;">
                        ${t("email.staffInvite.expiry")}
                      </p>

                      <!-- CTA Button -->
                      <table cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td align="center">
                            <a href="${inviteLink}"
                               style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                      color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;
                                      padding:14px 40px;border-radius:8px;
                                      box-shadow:0 4px 12px rgba(99,102,241,0.4);">
                              ${t("email.staffInvite.button")}
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Fallback link -->
                  <tr>
                    <td style="padding:0 40px 24px;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                        ${t("email.staffInvite.fallback")}
                      </p>
                      <p style="margin:4px 0 0;word-break:break-all;">
                        <a href="${inviteLink}" style="color:#6366f1;font-size:12px;">${inviteLink}</a>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                        ${t("email.staffInvite.ignore")}
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  async sendDailySummaryEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    /** The salon's currency (salons.currency) — every amount is printed in it. */
    currency?: string | null;
    summary?: {
      openingBalance?: number;
      cashRevenue?: number;
      cashExpense?: number;
      closingBalance?: number;
      inStoreCash?: number;
      reconciliationAmount?: number;
      remarks?: string;
      upiPaymentAmount?: number;
      cardPaymentAmount?: number;
    };
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, summary = {} } = params;
    const formatAmount = (val: number = 0) => formatMoney(val, params.currency);
    const dayLocale = languageDateLocale(lang) ?? dateLocale(params.currency);

    const recAmt = summary.reconciliationAmount ?? 0;
    const reconciliationBg = recAmt === 0 ? "#f0fdf4" : recAmt > 0 ? "#f0f9ff" : "#fef2f2";
    const reconciliationBorder = recAmt === 0 ? "#bbf7d0" : recAmt > 0 ? "#bae6fd" : "#fecaca";
    const reconciliationColor = recAmt === 0 ? "#16a34a" : recAmt > 0 ? "#0284c7" : "#dc2626";
    const reconciliationLabelColor = recAmt === 0 ? "#15803d" : recAmt > 0 ? "#0369a1" : "#991b1b";
    const reconciliationPrefix = recAmt > 0 ? "+" : "";

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.dailySummary.subject", { date: new Date().toLocaleDateString(dayLocale) }),
      html: `
        <!DOCTYPE html>
        <html ${htmlAttrs(lang)}>
        <head>
          <meta charset="UTF-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>${t("email.dailySummary.pageTitle")}</title>
        </head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="600" cellpadding="0" cellspacing="0"
                style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:600px;width:100%;">
                
                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 36px;">
                    <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">
                      ${t("email.dailySummary.title")}
                    </h1>
                    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                      ${new Date().toLocaleDateString(dayLocale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                    </p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.dailySummary.intro")}
                    </p>

                    <!-- Summary Cards Grid -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                      <!-- Row 1: Opening Balance & Cash Revenue -->
                      <tr>
                        <td width="48%" style="vertical-align:top;padding-bottom:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#64748b;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.opening")}</span>
                                <div style="font-size:20px;font-weight:800;color:#1e293b;">${formatAmount(summary.openingBalance)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="vertical-align:top;padding-bottom:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#15803d;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.cashRevenue")}</span>
                                <div style="font-size:20px;font-weight:800;color:#16a34a;">${formatAmount(summary.cashRevenue)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <!-- Row 2: Cash Expense & Closing Balance -->
                      <tr>
                        <td width="48%" style="vertical-align:top;padding-bottom:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#fffbeb;border:1px solid #fef3c7;border-left:4px solid #d97706;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#b45309;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.cashExpense")}</span>
                                <div style="font-size:20px;font-weight:800;color:#d97706;">${formatAmount(summary.cashExpense)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="vertical-align:top;padding-bottom:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f5f3ff;border:1px solid #ddd6fe;border-left:4px solid #6366f1;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#4338ca;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.closing")}</span>
                                <div style="font-size:20px;font-weight:800;color:#4f46e5;">${formatAmount(summary.closingBalance)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <!-- Row 3: In Store Cash & Reconciliation Amount -->
                      <tr>
                        <td width="48%" style="vertical-align:top;padding-bottom:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f0f9ff;border:1px solid #bae6fd;border-left:4px solid #0284c7;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#0369a1;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.inStore")}</span>
                                <div style="font-size:20px;font-weight:800;color:#0284c7;">${formatAmount(summary.inStoreCash)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="vertical-align:top;padding-bottom:16px;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:${reconciliationBg};border:1px solid ${reconciliationBorder};border-left:4px solid ${reconciliationColor};border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:${reconciliationLabelColor};letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.reconciliation")}</span>
                                <div style="font-size:20px;font-weight:800;color:${reconciliationColor};">${reconciliationPrefix}${formatAmount(summary.reconciliationAmount)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Row 4: UPI Payments & Card Payments -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 16px;">
                      <tr>
                        <td width="48%" style="vertical-align:top;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#f5f3ff;border:1px solid #ddd6fe;border-left:4px solid #7c3aed;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#5b21b6;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.upi")}</span>
                                <div style="font-size:20px;font-weight:800;color:#7c3aed;">${formatAmount(summary.upiPaymentAmount)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td width="4%"></td>
                        <td width="48%" style="vertical-align:top;">
                          <table width="100%" cellpadding="0" cellspacing="0"
                            style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #2563eb;border-radius:8px;padding:16px;">
                            <tr>
                              <td>
                                <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:#1d4ed8;letter-spacing:0.5px;display:block;margin-bottom:6px;">${t("email.dailySummary.card")}</span>
                                <div style="font-size:20px;font-weight:800;color:#2563eb;">${formatAmount(summary.cardPaymentAmount)}</div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    ${summary.remarks ? `
                      <div style="background:#f9fafb;border-radius:8px;padding:16px;border:1px solid #e5e7eb;margin-top:8px;">
                        <span style="font-size:12px;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:4px;">${t("email.dailySummary.remarks")}</span>
                        <p style="margin:0;color:#374151;font-size:14px;line-height:1.5;">${escapeHtml(summary.remarks)}</p>
                      </div>
                    ` : ''}
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#f9fafb;padding:20px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;text-align:center;">
                      ${t("email.dailySummary.footer", { year: new Date().getFullYear() })}
                    </p>
                  </td>
                </tr>

              </table>
            </td></tr>
          </table>
        </body>
        </html>
      `,
    });
  },

  // First template in this file to attach a file — nodemailer attachments
  // already work in this codebase (receipt-send.helper.ts proves it via the
  // heavier multi-channel notificationChannelsService dispatcher), but
  // payroll receipts go straight through this service/transporter since
  // only email is needed here, no SMS/WhatsApp fan-out.
  async sendSalaryReceiptEmail(params: {
    to: string;
    /** Recipient's salon — its language (salons.language) is used. */
    salonId?: string | null;
    /** Explicit language; wins over the salon's. */
    language?: string | null;
    staffFirstName: string;
    salonName: string;
    periodLabel: string;
    netPay: number;
    /** The salon's currency (salons.currency) — the net pay is printed in it. */
    currency?: string | null;
    pdfBuffer: Buffer;
    pdfFilename: string;
  }) {
    const lang = await emailLanguage(params);
    const t = translator(lang);
    const { to, staffFirstName, salonName, periodLabel, netPay, currency, pdfBuffer, pdfFilename } = params;
    const formattedNetPay = formatMoney(netPay, currency);

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: t("email.salary.subject", { salon: escapeHtml(salonName) }),
      html: `
        <!DOCTYPE html><html ${htmlAttrs(lang)}><head><meta charset="UTF-8"/></head>
        <body${bodyDir(lang)} style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#16a34a;padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${escapeHtml(salonName)}</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${t("email.salary.title")}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      ${t("email.salary.body", { name: escapeHtml(staffFirstName) })}
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0"
                      style="background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;">
                      <tr>
                        <td style="padding:20px 24px;">
                          <p style="margin:0 0 8px;color:#15803d;font-size:14px;"><strong>${t("email.label.period")}:</strong> ${escapeHtml(periodLabel)}</p>
                          <p style="margin:0;color:#15803d;font-size:20px;font-weight:800;"><strong>${t("email.label.netPay")}:</strong> ${formattedNetPay}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${t("email.common.footerAuto", { year: new Date().getFullYear() })}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
      attachments: [{ filename: pdfFilename, content: pdfBuffer }],
    });
  },

  // ── Client Requirements (REQ-XXX tickets) ────────────────────────────────
  // Sent to EACH developer assigned at requirement-creation time (multiple
  // developers can be assigned in the same Create Requirement form) —
  // separate from sendRequirementCreatedEmail's client-confirmation +
  // single internal-team-notification pair below.
  // Sent when a subscription tax invoice is issued (a Razorpay payment, or a bill a super admin created): the salon
  // owner gets the invoice as a PDF attachment. Best-effort: callers never await it.
  async sendSubscriptionInvoiceEmail(params: {
    to: string;
    salonName: string;
    invoiceNo: string;
    planLabel: string;
    amount: number;
    currency?: string;
    pdfBuffer: Buffer;
    pdfFilename: string;
  }) {
    const { to, salonName, invoiceNo, planLabel, amount, currency, pdfBuffer, pdfFilename } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const amountLabel = `${currency ?? "INR"} ${Number(amount).toFixed(2)}`;
    const summaryRow = (label: string, value: string, last = false) => `
      <tr>
        <td style="padding:8px 0;${last ? "" : "border-bottom:1px solid #e5e7eb;"}color:#6b7280;font-size:13px;">${label}</td>
        <td style="padding:8px 0;${last ? "" : "border-bottom:1px solid #e5e7eb;"}color:#111827;font-size:13px;font-weight:600;text-align:right;">${value}</td>
      </tr>`;

    await billingTransporter.sendMail({
      from: config.smtp.billingFrom,
      to,
      subject: `Your SalonoX Subscription Invoice ${escapeHtml(invoiceNo)}`,
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">SalonoX Billing</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Your subscription is active ✓</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(salonName)}</strong> team, thank you for your payment. Your SalonoX ${escapeHtml(planLabel)} subscription is now active, and you can continue managing your salon.
                    </p>
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Your payment invoice is attached to this email as a PDF (<strong>${escapeHtml(pdfFilename)}</strong>) for your records.
                    </p>

                    <div style="background:#f9fafb;border-radius:10px;padding:12px 22px;margin-bottom:24px;">
                      <table cellpadding="0" cellspacing="0" width="100%">
                        ${summaryRow("Invoice No.", escapeHtml(invoiceNo))}
                        ${summaryRow("Plan", escapeHtml(planLabel))}
                        ${summaryRow("Amount Paid", escapeHtml(amountLabel))}
                        ${summaryRow("Payment Status", `<span style="color:#16a34a;">Successful</span>`, true)}
                      </table>
                    </div>

                    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
                      <tr>
                        <td align="center">
                          <a href="${loginUrl}"
                             style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                    color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;
                                    padding:14px 36px;border-radius:8px;">
                            Login to SalonOx
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
                      Need help? Email us at
                      <a href="mailto:support@salonox.com" style="color:#6366f1;text-decoration:underline;">support@salonox.com</a>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
      attachments: [{ filename: pdfFilename, content: pdfBuffer }],
    });
  },

  // Sent the moment a Razorpay payment lands for an account whose salon isn't set up yet, so there is no invoice PDF to attach
  // (it is emailed separately once the salon exists). Best-effort: callers never await it.
  async sendSubscriptionPaymentReceivedEmail(params: {
    to: string;
    name: string;
    planLabel: string;
    amount: number;
    currency?: string;
    transactionId: string;
  }) {
    const { to, name, planLabel, amount, currency, transactionId } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const amountLabel = `${currency ?? "INR"} ${Number(amount).toFixed(2)}`;
    const row = (label: string, value: string, last = false) => `
      <tr>
        <td style="padding:8px 0;${last ? "" : "border-bottom:1px solid #e5e7eb;"}color:#6b7280;font-size:13px;">${label}</td>
        <td style="padding:8px 0;${last ? "" : "border-bottom:1px solid #e5e7eb;"}color:#111827;font-size:13px;font-weight:600;text-align:right;">${value}</td>
      </tr>`;

    await billingTransporter.sendMail({
      from: config.smtp.billingFrom,
      to,
      subject: "Payment received - your SalonoX subscription is active",
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">SalonoX Billing</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Payment received ✓</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(name)}</strong>, thank you for your payment. Your SalonoX ${escapeHtml(planLabel)} subscription is now active.
                    </p>
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Your invoice PDF will be emailed to you as soon as your salon setup is complete.
                    </p>
                    <div style="background:#f9fafb;border-radius:10px;padding:12px 22px;margin-bottom:24px;">
                      <table cellpadding="0" cellspacing="0" width="100%">
                        ${row("Plan", escapeHtml(planLabel))}
                        ${row("Amount Paid", escapeHtml(amountLabel))}
                        ${row("Transaction ID", escapeHtml(transactionId))}
                        ${row("Payment Status", `<span style="color:#16a34a;">Successful</span>`, true)}
                      </table>
                    </div>
                    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
                      <tr>
                        <td align="center">
                          <a href="${loginUrl}"
                             style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                    color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;
                                    padding:14px 36px;border-radius:8px;">
                            Login to SalonOx
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
                      Need help? Email us at
                      <a href="mailto:support@salonox.com" style="color:#6366f1;text-decoration:underline;">support@salonox.com</a>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  // Sent when a Super Admin gives a salon a plan ("Give plan"). No payment is involved, so nothing is attached.
  async sendPlanGrantedEmail(params: {
    to: string;
    salonName: string;
    planLabel: string;
    start: Date;
    end: Date;
  }) {
    const { to, salonName, planLabel, start, end } = params;
    const loginUrl = `${config.frontend.url}/login`;
    const fmt = (d: Date) => d.toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", year: "numeric" });
    const row = (label: string, value: string, last = false) => `
      <tr>
        <td style="padding:8px 0;${last ? "" : "border-bottom:1px solid #e5e7eb;"}color:#6b7280;font-size:13px;">${label}</td>
        <td style="padding:8px 0;${last ? "" : "border-bottom:1px solid #e5e7eb;"}color:#111827;font-size:13px;font-weight:600;text-align:right;">${value}</td>
      </tr>`;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: "Your SalonoX subscription is active",
      html: `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
        <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
            <tr><td align="center">
              <table width="560" cellpadding="0" cellspacing="0"
                style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
                <tr>
                  <td style="background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:28px 36px;">
                    <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">SalonoX Billing</p>
                    <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">Your subscription is active ✓</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                      Hi <strong>${escapeHtml(salonName)}</strong> team, the SalonoX ${escapeHtml(planLabel)} plan has been activated for your salon. You can continue managing your salon as usual.
                    </p>
                    <div style="background:#f9fafb;border-radius:10px;padding:12px 22px;margin-bottom:24px;">
                      <table cellpadding="0" cellspacing="0" width="100%">
                        ${row("Plan", escapeHtml(planLabel))}
                        ${row("Starts", escapeHtml(fmt(start)))}
                        ${row("Valid Until", escapeHtml(fmt(end)), true)}
                      </table>
                    </div>
                    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:24px;">
                      <tr>
                        <td align="center">
                          <a href="${loginUrl}"
                             style="display:inline-block;background:#6366f1;background-image:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);
                                    color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;
                                    padding:14px 36px;border-radius:8px;">
                            Login to SalonOx
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
                      Need help? Email us at
                      <a href="mailto:support@salonox.com" style="color:#6366f1;text-decoration:underline;">support@salonox.com</a>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} SalonOx. Automated notification.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body></html>`,
    });
  },

  async sendRequirementAssignedEmail(params: {
    to: string;
    developerName: string;
    reqNumber: string;
    title: string;
    salonName: string;
    priority: string;
    targetDate: string | null;
  }) {
    const { to, developerName, reqNumber, title, salonName, priority, targetDate } = params;
    const targetDateLabel = targetDate
      ? new Date(targetDate).toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", year: "numeric" })
      : null;

    const infoRows: [string, string][] = [
      ["Requirement", `${escapeHtml(reqNumber)} — ${escapeHtml(title)}`],
      ["Client", escapeHtml(salonName)],
      ["Priority", priorityBadgeHtml(priority)],
    ];
    if (targetDateLabel) infoRows.push(["Target Date", escapeHtml(targetDateLabel)]);

    const bodyHtml = `
      <p style="margin:0 0 22px;color:#374151;font-size:14.5px;line-height:1.65;">
        Hi <strong style="color:#0f172a;">${escapeHtml(developerName)}</strong>, you've been assigned to a client requirement. Here are the details:
      </p>
      ${infoCardHtml(infoRows, "#eef2ff", "#c7d2fe")}
      <p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
        Sign in to Super Admin → Client Requirements to view the full description and post updates.
      </p>`;

    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `New Requirement Assigned — ${escapeHtml(reqNumber)}: ${escapeHtml(title)}`,
      html: requirementEmailShell({
        eyebrow: reqNumber,
        heading: "You've Been Assigned a Requirement",
        accentColor: "#6366f1",
        bodyHtml,
      }),
    });
  },

  // Team notification recipient follows the same fallback chain
  // sendSupportTicketCreatedEmail already uses — SUPPORT_NOTIFICATION_EMAIL
  // env var, else the SMTP account itself.
  async sendRequirementCreatedEmail(params: {
    reqNumber: string;
    title: string;
    description: string;
    priority: string;
    salonName: string;
    submitterName: string | null;
    submitterEmail: string;
  }) {
    const { reqNumber, title, description, priority, salonName, submitterName, submitterEmail } = params;
    const teamEmail = process.env.SUPPORT_NOTIFICATION_EMAIL || config.smtp.user || config.smtp.from;

    // Client confirmation
    const clientBody = `
      <p style="margin:0 0 22px;color:#374151;font-size:14.5px;line-height:1.65;">
        Hi <strong style="color:#0f172a;">${escapeHtml(submitterName || "there")}</strong>, your requirement has been raised successfully. Our team will review it shortly and keep you updated by email at every step.
      </p>
      ${infoCardHtml([
        ["Requirement ID", escapeHtml(reqNumber)],
        ["Title", escapeHtml(title)],
        ["Status", `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:700;">Open</span>`],
      ], "#eef2ff", "#c7d2fe")}`;

    await transporter.sendMail({
      from: config.smtp.from,
      to: submitterEmail,
      subject: `Requirement Raised — ${escapeHtml(reqNumber)}: ${escapeHtml(title)}`,
      html: requirementEmailShell({
        eyebrow: salonName,
        heading: "Your Requirement Has Been Raised",
        accentColor: "#6366f1",
        bodyHtml: clientBody,
      }),
    });

    // Team notification
    const teamBody = `
      <p style="margin:0 0 22px;color:#374151;font-size:14.5px;line-height:1.65;">
        A new requirement was raised by <strong style="color:#0f172a;">${escapeHtml(salonName)}</strong>.
      </p>
      ${infoCardHtml([
        ["Requirement ID", escapeHtml(reqNumber)],
        ["Title", escapeHtml(title)],
        ["Priority", priorityBadgeHtml(priority)],
      ])}
      <div style="margin-top:20px;padding:16px 18px;background:#fff;border:1px solid #eef2f6;border-radius:10px;">
        <p style="margin:0 0 6px;color:#94a3b8;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">Description</p>
        <p style="margin:0;color:#374151;font-size:13.5px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(description)}</p>
      </div>`;

    await transporter.sendMail({
      from: config.smtp.from,
      to: teamEmail,
      subject: `New Requirement — ${escapeHtml(reqNumber)}: ${escapeHtml(title)}`,
      html: requirementEmailShell({
        eyebrow: "Client Requirements",
        heading: "New Requirement Raised",
        accentColor: "#0f172a",
        bodyHtml: teamBody,
      }),
    });
  },

  async sendRequirementStatusChangedEmail(params: {
    reqNumber: string;
    title: string;
    salonName: string;
    /** Assigned developers only — the salon owner is never emailed. */
    to: string[];
    newStatus: string;
    newStatusLabel: string;
  }) {
    const { reqNumber, title, salonName, to, newStatusLabel } = params;
    if (to.length === 0) return;
    const statusBadge = `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:700;">${escapeHtml(newStatusLabel)}</span>`;

    const teamBody = `
      <p style="margin:0 0 22px;color:#374151;font-size:14.5px;line-height:1.65;">
        Status changed for <strong style="color:#0f172a;">${escapeHtml(salonName)}</strong>'s requirement.
      </p>
      ${infoCardHtml([
        ["Requirement", `${escapeHtml(reqNumber)} — ${escapeHtml(title)}`],
        ["New Status", statusBadge],
      ])}`;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Status Updated — ${escapeHtml(reqNumber)}`,
      html: requirementEmailShell({ eyebrow: "Client Requirements", heading: "Requirement Status Updated", accentColor: "#0f172a", bodyHtml: teamBody }),
    });
  },

  async sendRequirementUpdateEmail(params: {
    reqNumber: string;
    title: string;
    salonName: string;
    /** Assigned developers only — the salon owner is never emailed. */
    to: string[];
    authorName: string | null;
    message: string;
  }) {
    const { reqNumber, title, salonName, to, authorName, message } = params;
    if (to.length === 0) return;

    const bodyHtml = `
      <p style="margin:0 0 20px;color:#374151;font-size:14.5px;line-height:1.65;">
        There's a new update on requirement <strong style="color:#0f172a;">${escapeHtml(reqNumber)}</strong> — ${escapeHtml(title)}, raised by <strong style="color:#0f172a;">${escapeHtml(salonName)}</strong>.
      </p>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px 20px;">
        <p style="margin:0 0 8px;color:#1e40af;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(authorName || "SalonoX Team")}</p>
        <p style="margin:0;color:#1e3a8a;font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(message)}</p>
      </div>`;
    const html = requirementEmailShell({ eyebrow: reqNumber, heading: "New Update on a Requirement", accentColor: "#3b82f6", bodyHtml });

    await transporter.sendMail({ from: config.smtp.from, to, subject: `Update — ${escapeHtml(reqNumber)}: ${escapeHtml(title)}`, html });
  },

  async sendRequirementCompletedEmail(params: {
    reqNumber: string;
    title: string;
    /** Assigned developers only — the salon owner is never emailed. */
    to: string[];
  }) {
    const { reqNumber, title, to } = params;
    if (to.length === 0) return;
    const bodyHtml = `
      <p style="margin:0 0 22px;color:#374151;font-size:14.5px;line-height:1.65;">
        This requirement has been marked as completed.
      </p>
      ${infoCardHtml([
        ["Requirement", escapeHtml(title)],
        ["Ticket", escapeHtml(reqNumber)],
        ["Status", `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:700;">Completed</span>`],
      ], "#f0fdf4", "#bbf7d0")}
      <p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
      </p>`;
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `Completed — ${escapeHtml(reqNumber)}: ${escapeHtml(title)}`,
      html: requirementEmailShell({ eyebrow: reqNumber, heading: "Requirement Completed", accentColor: "#16a34a", bodyHtml }),
    });
  },
};
