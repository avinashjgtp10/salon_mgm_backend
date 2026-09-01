import pool from '../../../../config/database'
import { AppError } from '../../../../middleware/error.middleware'
import { campaignsRepository } from './campaigns.repository'
import { campaignQueue } from '../queue/campaign.queue'
import { CreateCampaignBody } from './campaigns.types'
import logger from '../../../../config/logger'

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// Collapse duplicate phone numbers within one upload (comparing on digits only,
// so "+91 98..." and "9198..." count as the same person) — otherwise the same
// customer is messaged twice and total_contacts over-counts unique recipients.
function dedupeContacts<T extends { phone: string }>(contacts: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of contacts) {
    const key = String(c.phone ?? '').replace(/\D/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

// ── Queue batches for a campaign ──────────────────────────────────────────────
async function queueCampaignBatches(
  campaignId: string,
  salonId:    string,
  batchSize:  number
) {
  const ids     = await campaignsRepository.getContactIds(campaignId)
  const batches = chunk(ids, batchSize)
  for (let i = 0; i < batches.length; i++) {
    await campaignQueue.add('send-batch', {
      campaignId, salonId,
      batchIndex: i,
      contactIds: batches[i],
    }, { delay: i * 500 })
  }
}

export const campaignsService = {

  async getAll(salonId: string) {
    return campaignsRepository.findAll(salonId)
  },

  async getById(id: string, salonId: string) {
    const c = await campaignsRepository.findById(id, salonId)
    if (!c) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')
    return c
  },

  async create(salonId: string, body: CreateCampaignBody) {
    const { rows: tmpl } = await pool.query(
      `SELECT id FROM wa_templates
       WHERE id = $1 AND salon_id = $2 AND status = 'APPROVED'`,
      [body.template_id, salonId]
    )
    if (!tmpl[0]) throw new AppError(400, 'Template not found or not approved', 'TEMPLATE_NOT_APPROVED')

    const batchSize   = body.batch_size ?? 50
    const scheduledAt = body.scheduled_at ?? null
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date()

    const contacts = dedupeContacts(body.contacts)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const campaignId = await campaignsRepository.create(
        salonId, body.template_id, body.name, batchSize,
        contacts.length, scheduledAt
      )
      await campaignsRepository.bulkInsertContacts(campaignId, contacts)
      await client.query('COMMIT')

      if (!isScheduled) {
        // Send immediately
        await queueCampaignBatches(campaignId, salonId, batchSize)
      } else {
        logger.info(`📅 Campaign "${body.name}" scheduled for ${scheduledAt}`)
      }

      return campaignsRepository.findById(campaignId, salonId)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  },

  // ── Resend — relaunches the same campaign to its full original contact list,
  // optionally overriding the template's {{n}} variable values (e.g. an
  // updated discount/coupon) for this resend only — the original campaign's
  // own rows and contacts are never touched, this always creates a new one ──
  async resend(id: string, salonId: string, variables?: Record<string, string>) {
    const campaign = await this.getById(id, salonId)
    if (['SENDING', 'RUNNING', 'SCHEDULED'].includes(campaign.status)) {
      throw new AppError(400, 'Campaign is still in progress — wait for it to finish (or pause it) before resending', 'CAMPAIGN_IN_PROGRESS')
    }

    const { rows: tmpl } = await pool.query(
      `SELECT id FROM wa_templates WHERE id = $1 AND salon_id = $2 AND status = 'APPROVED'`,
      [campaign.template_id, salonId]
    )
    if (!tmpl[0]) throw new AppError(400, 'Original template is no longer approved — cannot resend', 'TEMPLATE_NOT_APPROVED')

    const contacts = dedupeContacts(await campaignsRepository.getAllContactsForResend(id))
    if (contacts.length === 0) throw new AppError(400, 'This campaign has no contacts to resend', 'NO_CONTACTS')

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Cluster-wide mutex on this source campaign id, held only for this
      // transaction — closes the double-click race that a plain read-check-
      // write left open (two near-simultaneous Resend clicks could otherwise
      // both pass every check above and each create their own duplicate
      // resend campaign). The loser gets a clear 409 instead of a silent
      // duplicate send; released automatically on COMMIT/ROLLBACK.
      const { rows: lockRows } = await client.query(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`, [id]
      )
      if (!lockRows[0].locked) {
        throw new AppError(409, 'A resend for this campaign is already in progress', 'RESEND_IN_PROGRESS')
      }

      // Edited variable values (if any) apply uniformly to every contact,
      // overriding whatever was stored on the original — a resend's whole
      // point is a salon-wide offer/discount/coupon change, not per-contact.
      const contactsToInsert = variables && Object.keys(variables).length > 0
        ? contacts.map(c => ({ ...c, variables: { ...c.variables, ...variables } }))
        : contacts

      const newCampaignId = await campaignsRepository.create(
        salonId, campaign.template_id, `${campaign.name} (Resend)`, campaign.batch_size,
        contactsToInsert.length, null
      )
      await campaignsRepository.bulkInsertContacts(newCampaignId, contactsToInsert)
      await client.query('COMMIT')

      await queueCampaignBatches(newCampaignId, salonId, campaign.batch_size)

      return campaignsRepository.findById(newCampaignId, salonId)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  },

  async pause(id: string, salonId: string) {
    await this.getById(id, salonId)
    return campaignsRepository.updateStatus(id, 'PAUSED')
  },

  async resume(id: string, salonId: string) {
    const campaign = await this.getById(id, salonId)
    const pending  = await campaignsRepository.getPendingContactIds(id)

    if (pending.length > 0) {
      const batches = chunk(pending, campaign.batch_size)
      for (let i = 0; i < batches.length; i++) {
        await campaignQueue.add('send-batch', {
          campaignId: id, salonId,
          batchIndex: i,
          contactIds: batches[i],
        }, { delay: i * 500 })
      }
    }

    return campaignsRepository.updateStatus(id, 'SENDING')
  },

  // ── Self-heal campaigns whose batch jobs died with no automatic retry left ──
  // (or the worker was down when they failed) — otherwise a stalled campaign
  // sits at whatever partial progress it reached forever, only fixable by an
  // admin manually finding it and clicking resume.
  async reconcileStalledCampaigns() {
    const stalled = await campaignsRepository.findStalledSending()
    if (stalled.length === 0) return

    logger.info(`🔁 Found ${stalled.length} stalled campaign(s) — reconciling`)

    for (const campaign of stalled) {
      try {
        const pending = await campaignsRepository.getPendingContactIds(campaign.id)
        if (pending.length === 0) {
          // Everything was actually processed — just the final completion
          // update itself never landed. Finish it, nothing left to send.
          await campaignsRepository.updateStatus(campaign.id, 'COMPLETED')
          continue
        }

        const batches = chunk(pending, campaign.batch_size)
        for (let i = 0; i < batches.length; i++) {
          await campaignQueue.add('send-batch', {
            campaignId: campaign.id, salonId: campaign.salon_id,
            batchIndex: i,
            contactIds: batches[i],
          }, { delay: i * 500 })
        }
        // Touches updated_at so this campaign isn't picked up again next tick
        // while the just-requeued batches are still working through it.
        await campaignsRepository.updateStatus(campaign.id, 'SENDING')
        logger.info(`✅ Reconciled campaign "${campaign.name}" — re-queued ${pending.length} pending contacts`)
      } catch (err: any) {
        logger.error(`❌ Failed to reconcile campaign ${campaign.id}: ${err.message}`)
      }
    }
  },

  // ── Run all scheduled campaigns that are due ──────────────────────────────
  async runDueScheduledCampaigns() {
    const due = await campaignsRepository.findDueScheduled()
    if (due.length === 0) return

    logger.info(`⏰ Running ${due.length} scheduled campaign(s)`)

    for (const campaign of due) {
      try {
        await campaignsRepository.updateStatus(campaign.id, 'SENDING', { started_at: true })
        await queueCampaignBatches(campaign.id, campaign.salon_id, campaign.batch_size)
        logger.info(`✅ Scheduled campaign "${campaign.name}" started`)
      } catch (err: any) {
        logger.error(`❌ Failed to start scheduled campaign "${campaign.name}": ${err.message}`)
      }
    }
  },

  async getContacts(id: string, salonId: string, status?: string, page?: number, limit?: number) {
  const campaign = await campaignsRepository.findById(id, salonId)
  if (!campaign) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')
  return campaignsRepository.getContacts(id, status, page ?? 1, limit ?? 50)
},

  async getReport(id: string, salonId: string, type: string) {
    await this.getById(id, salonId)
    return campaignsRepository.getReport(id, type)
  },
}