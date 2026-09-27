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
    let campaignId: string | undefined
    try {
      await client.query('BEGIN')
      // Both calls now run ON this same client — previously they queried the
      // shared pool directly, so BEGIN/COMMIT/ROLLBACK here were a complete
      // no-op: a failed bulkInsertContacts left the campaign row it had
      // already (auto-)committed sitting orphaned forever (total_contacts
      // set, but zero actual rows in wa_campaign_contacts) — and 10 minutes
      // later reconcileStalledCampaigns' "no pending contacts left = must be
      // done" check would wrongly flip that empty, broken campaign to
      // COMPLETED, hiding the failure entirely. Now a failed insert rolls
      // back cleanly and nothing is left behind.
      campaignId = await campaignsRepository.create(
        salonId, body.template_id, body.name, batchSize,
        contacts.length, scheduledAt, client
      )
      await campaignsRepository.bulkInsertContacts(campaignId, contacts, client)
      await client.query('COMMIT')
    } catch (err: any) {
      try { await client.query('ROLLBACK') } catch { /* connection may already be dead */ }
      logger.error(`❌ Campaign creation failed for salon ${salonId} (${contacts.length} contacts): ${err.message}`, { stack: err.stack })
      // Surface the real cause instead of letting it fall through to the
      // generic "Something went wrong" — this failure has no safe default
      // and needs to be actionable from the toast alone.
      throw err instanceof AppError ? err : new AppError(500, `Campaign creation failed: ${err.message}`, 'CAMPAIGN_CREATE_FAILED')
    } finally {
      client.release()
    }

    if (!isScheduled) {
      // Send immediately
      await queueCampaignBatches(campaignId, salonId, batchSize)
    } else {
      logger.info(`📅 Campaign "${body.name}" scheduled for ${scheduledAt}`)
    }

    return campaignsRepository.findById(campaignId, salonId)
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
    let newCampaignId: string | undefined
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

      // Both calls run ON this same client, same reasoning as create() above
      // — otherwise a failed bulkInsertContacts leaves an orphaned, contact-
      // less campaign row that reconcileStalledCampaigns later mislabels
      // COMPLETED instead of rolling back cleanly.
      newCampaignId = await campaignsRepository.create(
        salonId, campaign.template_id, `${campaign.name} (Resend)`, campaign.batch_size,
        contactsToInsert.length, null, client
      )
      await campaignsRepository.bulkInsertContacts(newCampaignId, contactsToInsert, client)
      await client.query('COMMIT')
    } catch (err: any) {
      try { await client.query('ROLLBACK') } catch { /* connection may already be dead */ }
      logger.error(`❌ Campaign resend failed for campaign ${id}: ${err.message}`, { stack: err.stack })
      throw err instanceof AppError ? err : new AppError(500, `Campaign resend failed: ${err.message}`, 'CAMPAIGN_RESEND_FAILED')
    } finally {
      client.release()
    }

    await queueCampaignBatches(newCampaignId, salonId, campaign.batch_size)

    return campaignsRepository.findById(newCampaignId, salonId)
  },

  // ── Resend to ONE failed/blocked contact — never touches any other contact
  // on the campaign, and never re-sends to one that already succeeded. Reuses
  // the exact same send worker as the original campaign (a single-contact
  // job on the same queue), so it goes through the same template/media/inbox
  // logic and updates that contact's own status, same as any other send.
  async resendContact(campaignId: string, contactId: string, salonId: string, resentBy: string | null) {
    const result = await this.resendContacts(campaignId, [contactId], salonId, resentBy)
    if (result.skipped.length > 0) {
      throw new AppError(400, result.skipped[0].reason, 'CONTACT_NOT_RESENDABLE')
    }
    return campaignsRepository.findContactById(contactId, campaignId)
  },

  // ── Bulk resend — "select all blocked/failed, resend" from the Contact
  // Details table's BLOCKED/FAILED filter tab. Each contact is individually
  // validated/logged/reset (same as the single-contact path), but all the
  // ones that pass go out as ONE job on the queue instead of one job per
  // contact — same batching the original campaign send already relies on,
  // just sized to however many were selected. A contact that's already
  // SENT/DELIVERED/READ (or simply not found) is skipped, not resent, and
  // reported back by id so the caller can tell the user which ones didn't
  // qualify instead of silently dropping them.
  async resendContacts(
    campaignId: string,
    contactIds: string[],
    salonId: string,
    resentBy: string | null,
  ): Promise<{ queued: string[]; skipped: Array<{ contactId: string; reason: string }> }> {
    if (contactIds.length === 0) throw new AppError(400, 'No contacts selected to resend', 'NO_CONTACTS')

    const campaign = await this.getById(campaignId, salonId)

    const { rows: tmpl } = await pool.query(
      `SELECT id FROM wa_templates WHERE id = $1 AND salon_id = $2 AND status = 'APPROVED'`,
      [campaign.template_id, salonId]
    )
    if (!tmpl[0]) throw new AppError(400, 'Original template is no longer approved — cannot resend', 'TEMPLATE_NOT_APPROVED')

    const queued: string[] = []
    const skipped: Array<{ contactId: string; reason: string }> = []

    for (const contactId of contactIds) {
      const contact = await campaignsRepository.findContactById(contactId, campaignId)
      if (!contact) { skipped.push({ contactId, reason: 'Contact not found on this campaign' }); continue }
      if (!['FAILED', 'BLOCKED'].includes(contact.status)) {
        skipped.push({ contactId, reason: `Already ${contact.status} — not resent` })
        continue
      }

      await campaignsRepository.logContactResend({
        contactId,
        campaignId,
        salonId,
        previousStatus: contact.status,
        previousErrorCode: contact.error_code ?? null,
        previousErrorMessage: contact.error_message ?? null,
        resentBy,
      })
      await campaignsRepository.resetContactForResend(contactId)
      queued.push(contactId)
    }

    if (queued.length > 0) {
      const batches = chunk(queued, campaign.batch_size)
      for (let i = 0; i < batches.length; i++) {
        await campaignQueue.add('send-batch', {
          campaignId, salonId,
          batchIndex: i,
          contactIds: batches[i],
        }, { delay: i * 500 })
      }
    }

    return { queued, skipped }
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
          // "No pending contacts" is only "everything was processed" if
          // there were ever any contact rows to process. A campaign whose
          // own contacts insert failed (see create()'s now-real transaction)
          // has total_contacts > 0 but zero actual rows — that's a creation
          // failure, not a finished send, and must not be reported as one.
          const actualContacts = await campaignsRepository.countContacts(campaign.id)
          if (actualContacts === 0) {
            await campaignsRepository.updateStatus(campaign.id, 'FAILED')
            logger.error(`❌ Campaign "${campaign.name}" (${campaign.id}) stalled with zero contact rows — marked FAILED instead of COMPLETED`)
            continue
          }
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