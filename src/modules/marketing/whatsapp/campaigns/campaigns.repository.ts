import pool from '../../../../config/database'
import { v4 as uuid } from 'uuid'
import { WACampaign, WACampaignContact } from './campaigns.types'

export const campaignsRepository = {

  async findAll(salonId: string): Promise<WACampaign[]> {
    const { rows } = await pool.query(`
      SELECT c.*, t.name AS template_name
      FROM wa_campaigns c
      JOIN wa_templates t ON t.id = c.template_id
      WHERE c.salon_id = $1
      ORDER BY c.created_at DESC
    `, [salonId])
    return rows
  },

  async findById(id: string, salonId: string): Promise<WACampaign | null> {
    const { rows } = await pool.query(`
      SELECT c.*, t.name AS template_name, t.body_text AS template_body
      FROM wa_campaigns c
      JOIN wa_templates t ON t.id = c.template_id
      WHERE c.id = $1 AND c.salon_id = $2
    `, [id, salonId])
    return rows[0] || null
  },

  // Find all SCHEDULED campaigns that are due to run
  async findDueScheduled(): Promise<WACampaign[]> {
    const { rows } = await pool.query(`
      SELECT c.*, t.name AS template_name
      FROM wa_campaigns c
      JOIN wa_templates t ON t.id = c.template_id
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
    scheduledAt?:  string | null   // NEW: optional schedule time
  ): Promise<string> {
    const campaignId = uuid()
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date()
    const status      = isScheduled ? 'SCHEDULED' : 'SENDING'

    await pool.query(`
      INSERT INTO wa_campaigns
        (id, salon_id, template_id, name, status, batch_size, total_contacts, scheduled_at, started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${isScheduled ? 'NULL' : 'NOW()'})
    `, [campaignId, salonId, templateId, name, status, batchSize, totalContacts, scheduledAt ?? null])
    return campaignId
  },

  async bulkInsertContacts(
    campaignId: string,
    contacts:   Array<{ phone: string; name?: string | null; variables?: Record<string, any> }>
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
      await pool.query(
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

  async getPendingContactIds(campaignId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT id FROM wa_campaign_contacts
       WHERE campaign_id = $1 AND status = 'PENDING'`,
      [campaignId]
    )
    return rows.map(r => r.id)
  },

  async updateStatus(id: string, status: string, extra?: { started_at?: boolean }): Promise<WACampaign> {
    const startedClause = extra?.started_at ? ', started_at = NOW()' : ''
    const { rows } = await pool.query(
      `UPDATE wa_campaigns SET status=$2${startedClause}, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, status]
    )
    return rows[0]
  },

  async getContacts(campaignId: string, status?: string): Promise<WACampaignContact[]> {
    const params: any[] = [campaignId]
    const statusFilter  = status ? `AND status = $2` : ''
    if (status) params.push(status)
    const { rows } = await pool.query(`
      SELECT * FROM wa_campaign_contacts
      WHERE campaign_id = $1 ${statusFilter}
      ORDER BY created_at ASC
    `, params)
    return rows
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