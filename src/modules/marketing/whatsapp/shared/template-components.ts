import { buildOfferComponents } from './offer-components'

// Send-time components for a wa_templates row (header media + body variables +
// offer/copy-code/carousel parts). Shared by the campaign worker and the Service
// Chain sender so a template goes out identically whichever way it is sent.

export type SendableTemplate = {
  body_text?:       string | null
  header_type?:     string | null
  header_media_id?: string | null
  buttons?:         Array<{ type: string; text?: string; value?: string }> | null
  lto_text?:        string | null
  carousel?:        any[] | null
}

// A template whose header is an image/video/document needs a stored Meta media id.
export function templateHasMediaHeader(t: SendableTemplate): boolean {
  return !!(t.header_type && t.header_type !== 'none' && t.header_type !== 'text')
}

export function buildTemplateSendComponents(
  t: SendableTemplate,
  opts: {
    // Positional values: `var1` / `1` keys; falls back to `fallbackName` for slot 1.
    variables?:   Record<string, any> | null
    fallbackName?: string | null
    flowToken?:   string
  }
): any[] {
  const components: any[] = []
  const variables = opts.variables ?? {}

  if (templateHasMediaHeader(t) && t.header_media_id) {
    const mt = t.header_type as string
    components.push({ type: 'header', parameters: [{ type: mt, [mt]: { id: t.header_media_id } }] })
  }

  const matches = (t.body_text ?? '').match(/\{\{\d+\}\}/g) ?? []
  if (matches.length > 0) {
    const params = matches.map((_: any, i: number) => ({
      type: 'text',
      text: String(
        variables[`var${i + 1}`] ||
        variables[String(i + 1)] ||
        (i === 0 && opts.fallbackName ? opts.fallbackName : null) ||
        `Value${i + 1}`
      ),
    }))
    components.push({ type: 'body', parameters: params })
  }

  // Offer templates: expiry countdown + copy-code button, per-contact values.
  const { afterBody } = buildOfferComponents(
    { buttons: t.buttons, lto_text: t.lto_text, carousel: t.carousel },
    { couponCode: variables.coupon_code, expiresAt: variables.offer_expires_at, flowToken: opts.flowToken }
  )
  components.push(...afterBody)

  return components
}
