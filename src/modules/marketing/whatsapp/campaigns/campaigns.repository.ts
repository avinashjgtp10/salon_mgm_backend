import pool from '../../../../config/database'
import { v4 as uuid } from 'uuid'
import { PoolClient } from 'pg'
import { WACampaign, WACampaignContact } from './campaigns.types'

// Both create() and bulkInsertContacts() below take an optional `db` (a
// checked-out PoolClient) so a caller running an explicit BEGIN/COMMIT can
// have these participate in that same transaction — pass the pool instead
// and they run as before, each auto-committing independently.
type Queryable = Pick<PoolClient, 'query'>

export const campaignsRepository = {

  async findAll(salonId: string): Promise<WACampaign[]> {
  const { rows } = await pool.query(`
    SELECT
      c.*,
      COALESCE(t.name, 'Deleted template') AS template_name,
      -- real counts from contacts table
      COUNT(cc.id) FILTER (WHERE cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED'))::int AS sent_count,
      COUNT(cc.id) FILTER (WHERE cc.status IN ('DELIVERED','READ'))::int AS delivered_count,
      COUNT(cc.id) FILTER (WHERE cc.status = 'READ')::int    AS read_count,
      COUNT(cc.id) FILTER (WHERE cc.status = 'FAILED')::int  AS failed_count,
      COUNT(cc.id) FILTER (WHERE cc.status = 'BLOCKED')::int AS blocked_count,
      COUNT(cc.id) FILTER (WHERE cc.status = 'SKIPPED')::int AS skipped_count
    FROM wa_campaigns c
    LEFT JOIN wa_templates t ON t.id = c.template_id
    LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
    WHERE c.salon_id = $1
    GROUP BY c.id, t.name
    ORDER BY c.created_at DESC
  `, [salonId])
  return rows
},

  async findById(id: string, salonId: string): Promise<WACampaign | null> {
    const { rows } = await pool.query(`
      SELECT c.*, COALESCE(t.name, 'Deleted template') AS template_name,
             t.body_text AS template_body
      FROM wa_campaigns c
      LEFT JOIN wa_templates t ON t.id = c.template_id
      WHERE c.id = $1 AND c.salon_id = $2
    `, [id, salonId])
    return rows[0] || null
  },

  async findDueScheduled(): Promise<WACampaign[]> {
    const { rows } = await pool.query(`
      SELECT c.*, COALESCE(t.name, 'Deleted template') AS template_name
      FROM wa_campaigns c
      LEFT JOIN wa_templates t ON t.id = c.template_id
      WHERE c.status = 'SCHEDULED'
        AND c.scheduled_at <= NOW()
    `)
    return rows
  },

  async create(
    salonId:       string,
    templateId:    string,
    name:          string,
    batchSize:     number,
    totalContacts: number,
    scheduledAt?:  string | null,
    db:            Queryable = pool
  ): Promise<string> {
    const campaignId  = uuid()
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date()
    const status      = isScheduled ? 'SCHEDULED' : 'SENDING'

    await db.query(`
      INSERT INTO wa_campaigns
        (id, salon_id, template_id, name, status, batch_size, total_contacts, scheduled_at, started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${isScheduled ? 'NULL' : 'NOW()'})
    `, [campaignId, salonId, templateId, name, status, batchSize, totalContacts, scheduledAt ?? null])
    return campaignId
  },

  async bulkInsertContacts(
    campaignId: string,
    contacts:   Array<{ phone: string; name?: string | null; variables?: Record<string, any> }>,
    db:         Queryable = pool
  ): Promise<void> {
    const CHUNK = 500
    for (let i = 0; i < contacts.length; i += CHUNK) {
      const chunk  = contacts.slice(i, i + CHUNK)
      const vals   = chunk.map((_c, j) => {
        const b = j * 5
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5}::jsonb)`
      }).join(',')
      const params = chunk.flatMap(c => [
        uuid(), campaignId, c.phone,
        c.name      ?? null,
        JSON.stringify(c.variables ?? {}),
      ])
      await db.query(
        `INSERT INTO wa_campaign_contacts (id, campaign_id, phone, name, variables) VALUES ${vals}`,
        params
      )
    }
  },

  async getContactIds(campaignId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT id FROM wa_campaign_contacts WHERE campaign_id = $1`,
      [campaignId]
    )
    return rows.map(r => r.id)
  },

  // ── Full original contact list for resend — includes everyone regardless of status ──
  async getAllContactsForResend(campaignId: string): Promise<Array<{ phone: string; name: string | null; variables: Record<string, any> }>> {
    const { rows } = await pool.query(
      `SELECT phone, name, variables FROM wa_campaign_contacts WHERE campaign_id = $1`,
      [campaignId]
    )
    return rows.map(r => ({ phone: r.phone, name: r.name, variables: r.variables ?? {} }))
  },

  // A campaign whose batch jobs all died (no BullMQ attempts left, or the
  // whole worker was down) never gets touched again on its own — updated_at
  // only advances when a batch job actually finishes. 10+ minutes with zero
  // progress on a still-"SENDING" campaign means something's stuck.
  // A SENDING campaign counts as stalled when contacts are still PENDING but nothing
  // has actually been sent for a few minutes.
  //
  // This used to be just "updated_at older than 10 minutes" - but updated_at is
  // refreshed by every batch AND by every delivery / read receipt Meta sends back
  // (refreshCampaignCounts), so a campaign that had lost some batches but was still
  // receiving receipts never looked stale, and sat half-sent until someone pressed
  // Pause then Resume by hand.
  //
  // "Last activity" therefore only looks at contacts that are still PENDING, or whose
  // status is the send result itself (SENT / FAILED / BLOCKED). DELIVERED and READ
  // rows are left out, because those are receipts, not sending progress.
  async findStalledSending(): Promise<WACampaign[]> {
    const { rows } = await pool.query(`
      SELECT c.*
      FROM wa_campaigns c
      WHERE c.status = 'SENDING'
        AND (
          -- pending contacts but no sending progress for 3 minutes
          (
            EXISTS (SELECT 1 FROM wa_campaign_contacts p WHERE p.campaign_id = c.id AND p.status = 'PENDING')
            AND COALESCE(
                  (SELECT MAX(a.updated_at) FROM wa_campaign_contacts a
                   WHERE a.campaign_id = c.id AND a.status IN ('SENT', 'FAILED', 'BLOCKED')),
                  c.started_at, c.created_at
                ) < NOW() - INTERVAL '3 minutes'
          )
          -- or: nothing pending any more yet the campaign never flipped to COMPLETED
          OR c.updated_at < NOW() - INTERVAL '10 minutes'
        )
    `)
    return rows
  },

  // Why messages of one campaign were not delivered: how many contacts per
  // (status, Meta error code, Meta's own text). Powers the "reasons" summary.
  async getFailureReasons(campaignId: string): Promise<Array<{ status: string; error_code: string | null; error_message: string | null; count: number }>> {
    const { rows } = await pool.query(`
      SELECT status, error_code, error_message, COUNT(*)::int AS count
      FROM wa_campaign_contacts
      WHERE campaign_id = $1 AND status IN ('FAILED', 'BLOCKED')
      GROUP BY status, error_code, error_message
      ORDER BY count DESC, status
    `, [campaignId])
    return rows
  },

  async getPendingContactIds(campaignId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT id FROM wa_campaign_contacts
       WHERE campaign_id = $1 AND status = 'PENDING'`,
      [campaignId]
    )
    return rows.map(r => r.id)
  },

  async countContacts(campaignId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM wa_campaign_contacts WHERE campaign_id = $1`,
      [campaignId]
    )
    return rows[0]?.n ?? 0
  },

  async updateStatus(id: string, status: string, extra?: { started_at?: boolean }): Promise<WACampaign> {
    const startedClause = extra?.started_at ? ', started_at = NOW()' : ''
    const { rows } = await pool.query(
      `UPDATE wa_campaigns SET status=$2${startedClause}, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, status]
    )
    return rows[0]
  },

  // Moves a campaign to `to` only if it is currently in one of `from`. Returns
  // null when it was not (someone else already paused/resumed/finished it), so a
  // double-click or two admins acting at once cannot both "win".
  async updateStatusIf(id: string, from: string[], to: string): Promise<WACampaign | null> {
    const { rows } = await pool.query(
      `UPDATE wa_campaigns SET status=$3, updated_at=NOW()
       WHERE id=$1 AND status = ANY($2::text[]) RETURNING *`,
      [id, from, to]
    )
    return rows[0] ?? null
  },

  // ── Per-contact manual Resend (FAILED/BLOCKED only) ───────────────────────
  async findContactById(contactId: string, campaignId: string): Promise<WACampaignContact | null> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_campaign_contacts WHERE id = $1 AND campaign_id = $2`,
      [contactId, campaignId]
    )
    return rows[0] ?? null
  },

  // Preserves the failed attempt's own record before the contact row gets
  // overwritten in place by the next send — otherwise the original error
  // (code/message) is gone the moment the resend's own result lands.
  async logContactResend(params: {
    contactId: string
    campaignId: string
    salonId: string
    previousStatus: string
    previousErrorCode: string | null
    previousErrorMessage: string | null
    resentBy: string | null
  }): Promise<void> {
    await pool.query(
      `INSERT INTO wa_campaign_contact_resends
         (campaign_contact_id, campaign_id, salon_id, previous_status, previous_error_code, previous_error_message, resent_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        params.contactId, params.campaignId, params.salonId,
        params.previousStatus, params.previousErrorCode, params.previousErrorMessage,
        params.resentBy,
      ]
    )
  },

  // Puts the contact back to PENDING so the existing worker (which only ever
  // selects `status = 'PENDING'` contacts — see campaign.processor.ts) picks
  // it up on the next job exactly like any other send, through the same
  // flow. Clears the prior attempt's result fields — logContactResend above
  // must be called first if that history needs to survive the overwrite.
  async resetContactForResend(contactId: string): Promise<void> {
    await pool.query(
      `UPDATE wa_campaign_contacts
       SET status = 'PENDING',
           error_code = NULL,
           error_message = NULL,
           wamid = NULL,
           sent_at = NULL,
           delivered_at = NULL,
           read_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [contactId]
    )
  },

  async getContacts(
  campaignId: string,
  status?:    string,
  page:       number = 1,
  limit:      number = 50
): Promise<{ contacts: WACampaignContact[]; total: number; page: number; totalPages: number }> {
  const offset = (page - 1) * limit
  const params: any[] = [campaignId]
  const statusFilter  = status ? `AND cc.status = $2` : ''
  if (status) params.push(status)

  // total count
  const { rows: [countRow] } = await pool.query(`
    SELECT COUNT(*) AS total
    FROM wa_campaign_contacts cc
    WHERE cc.campaign_id = $1 ${statusFilter}
  `, params)

  const total      = parseInt(countRow.total) || 0
  const totalPages = Math.ceil(total / limit)

  // paginated data
  const { rows } = await pool.query(`
    SELECT * FROM wa_campaign_contacts cc
    WHERE cc.campaign_id = $1 ${statusFilter}
    ORDER BY cc.created_at ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset])

  return { contacts: rows, total, page, totalPages }
},

  async getReport(campaignId: string, type: string): Promise<WACampaignContact[]> {
    const statusMap: Record<string, string[]> = {
      successful: ['DELIVERED', 'READ'],
      failed:     ['FAILED'],
      blocked:    ['BLOCKED'],
    }
    const statuses = statusMap[type] ?? []
    const { rows } = await pool.query(`
      SELECT * FROM wa_campaign_contacts
      WHERE campaign_id = $1 AND status = ANY($2::text[])
    `, [campaignId, statuses])
    return rows
  },
}