// Send-time components for the two "offer" template features:
//   • a copy-code button  → needs the real coupon code per send
//   • a limited-time offer → needs the expiry timestamp per send
// Shared by the campaign worker and the one-to-one Inbox sender so a template
// is built identically whichever way it goes out.

type OfferTemplate = {
  buttons?:  Array<{ type: string; text?: string; value?: string }> | null
  lto_text?: string | null
  // Carousel cards: [{ body, header_media_id, buttons: [{ type, text, value }] }]
  carousel?: Array<{ body?: string; header_media_id?: string; buttons?: Array<{ type: string; text?: string; value?: string }> }> | null
}

export function templateNeedsCouponCode(t: OfferTemplate): boolean {
  return (t.buttons ?? []).some(b => b.type === 'copy_code')
}

export function templateNeedsExpiry(t: OfferTemplate): boolean {
  return !!t.lto_text
}

// `expiry` may be an ISO string or epoch milliseconds (a string/number).
function toEpochMs(expiry: unknown): number | null {
  if (expiry === undefined || expiry === null || expiry === '') return null
  const n = Number(expiry)
  const ms = Number.isFinite(n) && n > 1e11 ? n : new Date(String(expiry)).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Returns the components to splice into a send. `headerAndBody` is whatever the
 * caller already built (header media, body variables); the LTO component must
 * come after the body and the button component after that, so the caller passes
 * them in two groups.
 * Throws an Error with a user-readable message if a required value is missing.
 */
export function buildOfferComponents(
  t: OfferTemplate,
  values: { couponCode?: string | null; expiresAt?: unknown; flowToken?: string }
): { afterBody: any[] } {
  const afterBody: any[] = []

  if (templateNeedsExpiry(t)) {
    const ms = toEpochMs(values.expiresAt)
    if (!ms) throw new Error('This offer template needs an expiry date/time')
    if (ms <= Date.now()) throw new Error('The offer expiry is in the past — pick a future date/time')
    afterBody.push({
      type: 'limited_time_offer',
      parameters: [{ type: 'limited_time_offer', limited_time_offer: { expiration_time_ms: ms } }],
    })
  }

  const buttons = t.buttons ?? []
  const copyIdx = buttons.findIndex(b => b.type === 'copy_code')
  if (copyIdx >= 0) {
    // Falls back to the sample code the template was submitted with, so a send
    // that forgot to set one still works rather than failing outright.
    const code = String(values.couponCode ?? '').trim() || String(buttons[copyIdx].value ?? '').trim()
    if (!code) throw new Error('This template needs a coupon code')
    afterBody.push({
      type: 'button',
      sub_type: 'copy_code',
      index: String(copyIdx),
      parameters: [{ type: 'coupon_code', coupon_code: code }],
    })
  }

  // A button that opens a WhatsApp Flow (the booking form) straight from the template.
  buttons.forEach((b, i) => {
    if (b.type !== 'flow') return
    afterBody.push({
      type: 'button',
      sub_type: 'flow',
      index: String(i),
      parameters: [{ type: 'action', action: { flow_token: values.flowToken || `flow:${Date.now()}` } }],
    })
  })

  // Carousel: one entry per card - its image, plus a payload for each quick-reply button.
  const cards = t.carousel ?? []
  if (cards.length > 0) {
    afterBody.push({
      type: 'carousel',
      cards: cards.map((card, i) => {
        if (!card.header_media_id) throw new Error(`Carousel card ${i + 1} has no image stored - re-create the template`)
        const components: any[] = [{ type: 'header', parameters: [{ type: 'image', image: { id: card.header_media_id } }] }]
        ;(card.buttons ?? []).forEach((b, j) => {
          if (b.type === 'quick_reply') {
            components.push({ type: 'button', sub_type: 'quick_reply', index: String(j), parameters: [{ type: 'payload', payload: `card${i + 1}_btn${j + 1}` }] })
          }
        })
        return { card_index: i, components }
      }),
    })
  }

  return { afterBody }
}
