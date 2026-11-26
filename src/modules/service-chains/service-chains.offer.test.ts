// Regression for the real failure "This offer template needs an expiry date/time": a limited-time-offer template (the image
// template "treat_yourself_today" in dev) was sent by a chain without the moment the offer ends, so it never went out.
import { buildTemplateSendComponents } from '../marketing/whatsapp/shared/template-components'
import { templateNeedsExpiry } from '../marketing/whatsapp/shared/offer-components'
import { CHAIN_OFFER_VALID_DAYS, chainOfferExpiryMs } from './service-chains.rules'

const offerTemplate = {
  body_text: 'Hi {{1}}, treat yourself today!',
  header_type: 'image',
  header_media_id: 'media-1',
  lto_text: 'Limited offer',
  buttons: [{ type: 'url', text: 'Book', value: 'https://x.test' }],
}

describe('chainOfferExpiryMs', () => {
  it('ends the offer a fixed time after it is sent', () => {
    const now = Date.parse('2026-11-26T10:00:00Z')
    expect(chainOfferExpiryMs(now) - now).toBe(CHAIN_OFFER_VALID_DAYS * 24 * 3600_000)
    expect(chainOfferExpiryMs(now)).toBeGreaterThan(now)
  })
})

describe('a chain message built from an offer template', () => {
  it('is what failed before: no expiry given', () => {
    expect(templateNeedsExpiry(offerTemplate)).toBe(true)
    expect(() => buildTemplateSendComponents(offerTemplate, { variables: { '1': 'Asha' } })).toThrow('This offer template needs an expiry date/time')
  })

  it('goes out once the runner supplies the expiry, with image header, body and the countdown', () => {
    const expiry = chainOfferExpiryMs(Date.now())
    const components = buildTemplateSendComponents(offerTemplate, { variables: { '1': 'Asha', offer_expires_at: String(expiry) } })
    expect(components.map((c) => c.type)).toEqual(['header', 'body', 'limited_time_offer'])
    expect(components[0]).toEqual({ type: 'header', parameters: [{ type: 'image', image: { id: 'media-1' } }] })
    expect(components[2].parameters[0].limited_time_offer.expiration_time_ms).toBe(expiry)
  })

  it('leaves templates that are not offers alone', () => {
    const plain = { body_text: 'Hi {{1}}', header_type: 'none', buttons: null, lto_text: null }
    expect(templateNeedsExpiry(plain)).toBe(false)
    expect(buildTemplateSendComponents(plain, { variables: { '1': 'Asha' } }).map((c) => c.type)).toEqual(['body'])
  })
})
