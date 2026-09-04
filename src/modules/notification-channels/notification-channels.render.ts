// ============================================================
// SalonOx — Notification Channel Templates: Rendering
// ============================================================

import { AutomationEventType } from "../whatsapp-automation/whatsapp-automation.types"
import { DefaultPurchaseEventType, EVENT_VARIABLE_NAMES } from "./notification-channels-defaults"

// Every existing trigger() call site already builds its variables object
// positionally ({'1': 'Nishant', '2': 'Style Studio', ...}) to match Meta's
// {{n}} numbering — EVENT_VARIABLE_NAMES' order is guaranteed to line up
// with that (see the comment on that map in wa-automation-defaults.ts).
// Converting to named form here is what lets every existing call site work
// for SMS/Email with zero changes.
export function positionalToNamed(eventType: AutomationEventType, variables: Record<string, string>): Record<string, string> {
  const names = EVENT_VARIABLE_NAMES[eventType as DefaultPurchaseEventType]
  if (!names) return {}
  const named: Record<string, string> = {}
  names.forEach((name, idx) => {
    named[name] = variables[String(idx + 1)] ?? ""
  })
  return named
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")

// Plain {{name}} substitution. escapeHtmlValues=true for the Email path
// (values are about to land inside an HTML document); false for SMS (plain
// text, no HTML entities wanted). A named token with no matching variable
// renders as an empty string, same permissive behavior as the WhatsApp
// processor's own fallback for an unset value.
export function renderTemplate(text: string, namedVars: Record<string, string>, escapeHtmlValues: boolean): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_match, name: string) => {
    const raw = namedVars[name] ?? ""
    return escapeHtmlValues ? escapeHtml(raw) : raw
  })
}

// One shared branded envelope for every event's Email body — self-contained
// rather than imported from email.service.ts, since that file's internal
// styling constants aren't exported and this feature deliberately doesn't
// touch that file's method bodies.
//
// `subject` and `bodyText` must already be rendered via renderTemplate(...,
// escapeHtmlValues=true) by the caller — this function does not escape them
// again (that would double-escape entities). `salonName` is the one raw,
// unescaped value this function itself is responsible for escaping.
export function renderChannelEmailHtml(params: { subject: string; bodyText: string; salonName: string }): string {
  const { subject, bodyText, salonName } = params
  const safeSalonName = escapeHtml(salonName)
  // bodyText already has its variables substituted (and HTML-escaped) by
  // renderTemplate — safe to drop into <p> tags after converting newlines.
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.6;white-space:pre-line;">${block}</p>`)
    .join("")

  return `
    <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head>
    <body style="margin:0;padding:0;background:#f4f4f7;font-family:'Segoe UI',Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:36px 0;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0"
            style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);max-width:560px;width:100%;">
            <tr>
              <td style="background:#111111;padding:28px 36px;">
                <p style="margin:0;color:#fff;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;">${safeSalonName}</p>
                <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:800;">${subject}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 36px;">
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} ${safeSalonName}. Automated notification.</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body></html>`
}
