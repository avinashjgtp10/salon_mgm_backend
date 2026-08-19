import { Worker, Job } from 'bullmq'
import pool from '../../../../config/database'
import { redisConnection, CampaignJobData } from './campaign.queue'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { inboxRepository } from '../inbox/inbox.repository'
import { webhooksRepository } from '../webhooks/webhooks.repository'

// ── Normalize phone to E.164 ──────────────────────────────────────────────────
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('+'))                           return '+' + digits
  if (digits.length === 10)                            return '+91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  return '+' + digits
}

export const campaignWorker = new Worker<CampaignJobData>(
  'wa-campaign-messages',
  async (job: Job<CampaignJobData>) => {
    const { campaignId, salonId, contactIds } = job.data

    const { rows: [camp] } = await pool.query(
      `SELECT status FROM wa_campaigns WHERE id = $1`,
      [campaignId]
    )
    if (!camp || camp.status === 'PAUSED') {
      return
    }

    const { rows: [waConfig] } = await pool.query(
      `SELECT * FROM whatsapp_configs WHERE salon_id = $1`,
      [salonId]
    )
    if (!waConfig) throw new Error(`WhatsApp not configured for salon ${salonId}`)

    const { rows: [campaign] } = await pool.query(`
      SELECT c.*, t.name AS template_name, t.body_text,
             t.language, t.header_type, t.header_media_id
      FROM wa_campaigns c
      LEFT JOIN wa_templates t ON t.id = c.template_id
      WHERE c.id = $1
    `, [campaignId])

    // ── Pre-flight: catch missing media ID ────────────────────────────────────
    const hasMediaHeader = (
      campaign.header_type &&
      campaign.header_type !== 'none' &&
      campaign.header_type !== 'text'
    )
    if (hasMediaHeader && !campaign.header_media_id) {
      await pool.query(`
        UPDATE wa_campaign_contacts
        SET status        = 'FAILED',
            error_code    = 'MISSING_MEDIA_ID',
            error_message = 'Template has a media header but no media ID stored. Re-create the template with a file upload.',
            updated_at    = NOW()
        WHERE id = ANY($1::uuid[])
      `, [contactIds])

      await pool.query(`
        UPDATE wa_campaigns
        SET status       = 'FAILED',
            failed_count = failed_count + $1,
            updated_at   = NOW()
        WHERE id = $2
      `, [contactIds.length, campaignId])

      console.error(`❌ Campaign ${campaignId} aborted: template "${campaign.template_name}" has ${campaign.header_type} header but no header_media_id in DB.`)
      return
    }

    // Only PENDING — if this job is a BullMQ retry after a partial failure
    // (e.g. the job threw after some contacts were already marked SENT/FAILED/
    // BLOCKED but before finishing), this must not re-fetch and re-send to
    // contacts already handled in the previous attempt.
    const { rows: contacts } = await pool.query(
      `SELECT * FROM wa_campaign_contacts WHERE id = ANY($1::uuid[]) AND status = 'PENDING'`,
      [contactIds]
    )

    let sent = 0, failed = 0, blocked = 0

    for (const contact of contacts) {
      // ← normalize phone before sending — prevents duplicate conversations
      const normalizedPhone = normalizePhone(contact.phone)

      try {
        const matches    = (campaign.body_text ?? '').match(/\{\{\d+\}\}/g) ?? []
        const components: any[] = []

        if (hasMediaHeader && campaign.header_media_id) {
          const mt = campaign.header_type
          components.push({
            type:       'header',
            parameters: [{ type: mt, [mt]: { id: campaign.header_media_id } }],
          })
        }

        if (matches.length > 0) {
          const variables = contact.variables ?? {}
          const params    = matches.map((_: any, i: number) => ({
            type: 'text',
            text: String(
              variables[`var${i + 1}`] ||
              variables[String(i + 1)]  ||
              (i === 0 && contact.name ? contact.name : null) ||
              `Value${i + 1}`
            ),
          }))
          components.push({ type: 'body', parameters: params })
        }

        const result = await whatsappMetaApi.sendTemplateMessage({
          phoneNumberId: waConfig.phone_number_id,
          accessToken:   waConfig.access_token,
          to:            normalizedPhone,   // ← use normalized
          templateName:  campaign.template_name,
          language:      campaign.language,
          components,
        })

        const wamid = result?.messages?.[0]?.id

        await pool.query(
          `UPDATE wa_campaign_contacts
           SET status='SENT', wamid=$1, sent_at=NOW(), updated_at=NOW()
           WHERE id=$2`,
          [wamid, contact.id]
        )

        // ── Save to inbox ────────────────────────────────────────────────────
        try {
          const messageBody = campaign.body_text ?? ''

          const mediaLabel =
            campaign.header_type === 'image'    ? '🖼 [Image]'    :
            campaign.header_type === 'video'    ? '🎬 [Video]'    :
            campaign.header_type === 'document' ? '📄 [Document]' : ''

          const lastMessagePreview = mediaLabel
            ? mediaLabel + (messageBody ? ' ' + messageBody.slice(0, 60) : '')
            : messageBody

          const conversationId = await inboxRepository.upsertConversation(
            salonId,
            normalizedPhone,        // ← use normalized — prevents duplicate conversations
            contact.name ?? null,
            lastMessagePreview,
            false                   // outbound — don't increment unread
          )

          await inboxRepository.insertMessage({
            conversationId,
            salonId,
            direction: 'OUTBOUND',
            body:      messageBody,
            wamid:     wamid ?? null,
            status:    'SENT',
            mediaType: hasMediaHeader ? campaign.header_type : null,
            mediaUrl:  hasMediaHeader ? campaign.header_media_id : null,
          })
        } catch (inboxErr) {
          console.error(`⚠️ Inbox write failed for ${normalizedPhone}:`, inboxErr)
        }

        sent++

      } catch (err: any) {
        const errObj      = err?.response?.data?.error ?? {}
        const code        = errObj.code?.toString()    ?? 'unknown'
        const msg         = errObj.message             ?? err.message ?? 'Unknown error'
        const isBlocked   = [131047, 131026, 131051, 131049].includes(parseInt(code))
        // 131042 = "Business eligibility payment issue" — Meta account-level
        // billing/eligibility block, not a per-recipient problem. Tagged
        // separately so it's unmistakable in logs/DB if it recurs (previously
        // diagnosed as the root cause of the "GoodHairDayOffer" mass-failure).
        const isBilling   = parseInt(code) === 131042

        await pool.query(
          `UPDATE wa_campaign_contacts
           SET status=$1, error_code=$2, error_message=$3, updated_at=NOW()
           WHERE id=$4`,
          [(isBlocked || isBilling) ? 'BLOCKED' : 'FAILED', code, msg, contact.id]
        );
        if (isBlocked || isBilling) { blocked++ } else { failed++ }
      }

      // 200ms delay between sends — respects Meta TPS limit
      await new Promise(r => setTimeout(r, 200))
    }

    // Recompute the campaign's counts ABSOLUTELY from the contacts table (the
    // single source of truth), not by incrementing. The old `sent_count = sent_count + $1`
    // raced with the webhook handler's full-recompute (delivery/read receipts
    // arrive continuously mid-send), and a safeQuery auto-retry on a dropped ack
    // could double-apply an increment — together these caused sent_count to
    // fluctuate up/down and even exceed total_contacts in production. Using the
    // same idempotent recompute on both paths removes the race entirely. This
    // also flips the campaign to COMPLETED when everything is terminal.
    void sent; void failed; void blocked;
    await webhooksRepository.refreshCampaignCounts(campaignId)
  },
  // concurrency was 100 against a Postgres pool capped at 20 (config/database.ts) —
  // with 20+ batch jobs hitting the DB nearly simultaneously, pool contention/
  // timeouts on the unprotected top-of-job queries was the main driver of
  // batches failing outright at scale. 10 leaves real headroom for the rest
  // of the app sharing the same pool.
  { connection: redisConnection, concurrency: 10 }
)

campaignWorker.on('failed', (j, e) => console.error(`❌ WA Job ${j?.id} failed:`, e.message))