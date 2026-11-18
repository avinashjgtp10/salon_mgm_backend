// Content rules for the plain-text templates LUNOX drafts for Service Chains (body + optional footer + https link buttons).
// Shared by the draft endpoints and the LUNOX writer so both reject the same things Meta would.
import type { WAButton } from './templates.types'

// Meta shows reviewers an example for every {{n}}; realistic values read better than "Example1".
// Position follows the convention LUNOX writes with: {{1}} client first name, {{2}} service, {{3}} salon.
const SAMPLE_VALUES = ['Priya', 'Hair Spa', 'Glow Salon', 'Monday', '12 Dec']
export const sampleFor = (n: number): string => SAMPLE_VALUES[n - 1] ?? `Sample${n}`

// Utility templates must be about something the client already booked or received. Offer language gets them
// re-categorised as Marketing (a higher price) or rejected, so catch it before submitting.
const UTILITY_PROMO = /\b(offers?|discounts?|sale|deals?|cashback|coupons?|promo(?:tion)?s?|limited[- ]time|hurry|special price|free)\b|%\s?off/i

function utilityPromoProblem(body: string): string | null {
  const m = UTILITY_PROMO.exec(body)
  return m ? `A Utility message can't contain offer or discount wording ("${m[0]}"). Remove it or switch the template to Marketing.` : null
}

const NAME_RE = /^[a-z0-9_]{1,512}$/

type TextTemplateInput = {
  name: string
  category: string
  language: string
  body_text: string
  footer_text?: string | null
  buttons?: WAButton[] | null
}

// Returns the first problem with the template, or null when it is fine to store / send to Meta.
export function textTemplateProblem(t: TextTemplateInput): string | null {
  if (!NAME_RE.test(String(t.name ?? ''))) return 'The template name can only use lowercase letters, numbers and underscores.'
  if (t.category !== 'UTILITY' && t.category !== 'MARKETING') return 'Choose Utility or Marketing.'
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(String(t.language ?? ''))) return 'Choose a language.'
  const body = String(t.body_text ?? '').trim()
  if (!body) return 'The message is empty.'
  if (body.length > 1024) return 'The message is longer than 1024 characters.'

  const vars = (body.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, '')))
  const distinct = [...new Set(vars)].sort((a, b) => a - b)
  if (distinct.some((n, i) => n !== i + 1)) return 'Variables must be numbered {{1}}, {{2}}, {{3}} in order, with none skipped.'
  if (/^\s*\{\{/.test(body) || /\}\}\s*[.!?]?\s*$/.test(body)) return 'The message cannot start or end with a variable.'
  if (/\}\}\s*\{\{/.test(body)) return 'Two variables cannot sit next to each other.'
  if (distinct.length * 2 + 1 > body.split(/\s+/).length) return 'There is not enough text around the variables.'
  if (/https?:\/\//i.test(body)) return 'Put links in a button, not in the message text.'

  const footer = String(t.footer_text ?? '')
  if (footer.length > 60) return 'The footer is longer than 60 characters.'
  if (/\{\{/.test(footer)) return 'The footer cannot contain variables.'

  const buttons = t.buttons ?? []
  if (buttons.length > 2) return 'At most 2 buttons.'
  for (const b of buttons) {
    if (b.type !== 'url') return 'Only link buttons are supported here.'
    if (!b.text?.trim() || b.text.length > 25) return 'A button label must be 1 to 25 characters.'
    if (!/^https:\/\/\S+\.\S+/.test(b.value ?? '')) return 'A button link must start with https://'
  }

  if (t.category === 'UTILITY') return utilityPromoProblem(body)
  return null
}
