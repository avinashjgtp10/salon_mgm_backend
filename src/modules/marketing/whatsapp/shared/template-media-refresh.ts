import { whatsappMetaApi } from './whatsapp.api'
import { templatesRepository } from '../templates/templates.repository'
import { templateHasMediaHeader } from './template-components'

// Meta forgets an uploaded media id ~30 days after the upload, so a template's header image (and a carousel's card images) stops
// working a month after it was created: every send then fails. The template's SAMPLE file lives on Meta for as long as the
// template does, so an expired image is rebuilt from it: download the sample, upload it again, store the new id.
//
// Used before a Service Chain message goes out. Checking costs one cheap Meta call per image, so a template that was found fine
// is not looked at again for a few hours.

export interface RefreshableTemplate {
  id: string
  salon_id: string
  meta_template_id?: string | null
  header_type?: string | null
  header_media_id?: string | null
  carousel?: Array<{ header_media_id?: string } & Record<string, unknown>> | null
}

export interface FreshMedia {
  header_media_id: string | null
  carousel: RefreshableTemplate['carousel']
}

const RECHECK_MS = 6 * 3600_000
const checkedAt = new Map<string, number>()

/** Forgets what was checked (tests). */
export const resetMediaRefreshMemory = () => checkedAt.clear()

const extensionFor = (mime: string) => (mime.includes('png') ? 'png' : mime.includes('mp4') ? 'mp4' : mime.includes('pdf') ? 'pdf' : 'jpg')

export class MediaRefreshError extends Error {}

export async function ensureTemplateMediaFresh(
  t: RefreshableTemplate,
  cfg: { phone_number_id: string; access_token: string },
): Promise<FreshMedia> {
  const result: FreshMedia = { header_media_id: t.header_media_id ?? null, carousel: t.carousel ?? null }
  const hasHeader = templateHasMediaHeader(t) && !!t.header_media_id
  const cards = Array.isArray(t.carousel) ? t.carousel : []
  if (!hasHeader && cards.length === 0) return result

  const last = checkedAt.get(t.id)
  if (last && Date.now() - last < RECHECK_MS) return result

  // ── Header image / video / document ──
  if (hasHeader && !(await whatsappMetaApi.isMediaAlive(cfg.access_token, t.header_media_id!))) {
    if (!t.meta_template_id) throw new MediaRefreshError('The template image has expired on WhatsApp and cannot be refreshed. Re-upload it in Marketing > Templates.')
    const sample = await whatsappMetaApi.getTemplateHeaderExample(cfg.access_token, t.meta_template_id)
    if (!sample) throw new MediaRefreshError('The template image has expired on WhatsApp and Meta has no sample to rebuild it from. Re-upload it in Marketing > Templates.')
    const newId = await whatsappMetaApi.uploadMedia({
      phoneNumberId: cfg.phone_number_id, accessToken: cfg.access_token,
      buffer: sample.buffer, mimeType: sample.mimeType, filename: `header.${extensionFor(sample.mimeType)}`,
    })
    await templatesRepository.updateMediaId(t.id, t.salon_id, newId)
    result.header_media_id = newId
  }

  // ── Carousel cards ──
  if (cards.length > 0) {
    const alive = await Promise.all(cards.map((c) => (c.header_media_id ? whatsappMetaApi.isMediaAlive(cfg.access_token, c.header_media_id) : Promise.resolve(false))))
    if (alive.some((ok) => !ok)) {
      if (!t.meta_template_id) throw new MediaRefreshError('A carousel image has expired on WhatsApp and cannot be refreshed. Re-create the template.')
      const samples = await whatsappMetaApi.getTemplateCarouselExamples(cfg.access_token, t.meta_template_id)
      const renewed = await Promise.all(cards.map(async (card, i) => {
        if (alive[i]) return card
        const sample = samples[i]
        if (!sample) throw new MediaRefreshError(`Carousel card ${i + 1}'s image has expired on WhatsApp and Meta has no sample to rebuild it from. Re-create the template.`)
        const newId = await whatsappMetaApi.uploadMedia({
          phoneNumberId: cfg.phone_number_id, accessToken: cfg.access_token,
          buffer: sample.buffer, mimeType: sample.mimeType, filename: `card${i + 1}.${extensionFor(sample.mimeType)}`,
        })
        return { ...card, header_media_id: newId }
      }))
      await templatesRepository.updateCarousel(t.id, t.salon_id, renewed)
      result.carousel = renewed
    }
  }

  checkedAt.set(t.id, Date.now())
  return result
}
