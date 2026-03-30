import pool from '../../../../config/database'
import { WAWebhookEvent } from './webhooks.types'

export const webhooksRepository = {

  async findVerifyToken(salonId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT webhook_verify_token FROM whatsapp_configs WHERE salon_id = $1`,
      [salonId]
    )
    return rows[0]?.webhook_verify_token ?? null
  },

  async findContactByWamid(wamid: string) {
    const { rows } = await pool.query(
      `SELECT id, campaign_id FROM wa_campaign_contacts WHERE wamid = $1`,
      [wamid]
    )
    return rows[0] || null
  },

  async markDelivered(wamid: string, timestamp: Date): Promise<void> {
    await pool.query(
      `UPDATE wa_campaign_contacts
       SET status='DELIVERED', delivered_at=$1, updated_at=NOW()
       WHERE wamid=$2`,
      [timestamp, wamid]
    )
  },

  async markRead(wamid: string, timestamp: Date): Promise<void> {
    await pool.query(
      `UPDATE wa_campaign_contacts
       SET status='READ', read_at=$1, updated_at=NOW()
       WHERE wamid=$2`,
      [timestamp, wamid]
    )
  },

  async markFailed(
    wamid:        string,
    status:       string,
    errorCode:    string | null,
    errorMessage: string | null
  ): Promise<void> {
    await pool.query(
      `UPDATE wa_campaign_contacts
       SET status=$1, error_code=$2, error_message=$3, updated_at=NOW()
       WHERE wamid=$4`,
      [status, errorCode, errorMessage, wamid]
    )
  },

  async refreshCampaignCounts(campaignId: string): Promise<void> {
    const { rows: [c] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ')) AS sent_count,
        COUNT(*) FILTER (WHERE status IN ('DELIVERED','READ'))        AS delivered_count,
        COUNT(*) FILTER (WHERE status = 'READ')                       AS read_count,
        COUNT(*) FILTER (WHERE status = 'FAILED')                     AS failed_count,
        COUNT(*) FILTER (WHERE status = 'BLOCKED')                    AS blocked_count,
        COUNT(*)                                                       AS total
      FROM wa_campaign_contacts WHERE campaign_id = $1
    `, [campaignId])

    const done    = parseInt(c.sent_count) + parseInt(c.failed_count) + parseInt(c.blocked_count)
    const allDone = done >= parseInt(c.total)

    await pool.query(`
      UPDATE wa_campaigns SET
        sent_count      = $1,
        delivered_count = $2,
        read_count      = $3,
        failed_count    = $4,
        blocked_count   = $5,
        ${allDone ? "status = 'COMPLETED', completed_at = NOW()," : ''}
        updated_at      = NOW()
      WHERE id = $6
    `, [c.sent_count, c.delivered_count, c.read_count, c.failed_count, c.blocked_count, campaignId])
  },

  async getRecentEvents(salonId: string, campaignId?: string): Promise<WAWebhookEvent[]> {
    const params: any[] = [salonId]
    const campaignFilter = campaignId ? `AND cc.campaign_id = $2` : ''
    if (campaignId) params.push(campaignId)

    const { rows } = await pool.query(`
      SELECT
        cc.id, cc.phone, cc.name, cc.status, cc.wamid,
        cc.campaign_id, c.name AS campaign_name,
        cc.sent_at, cc.delivered_at, cc.read_at, cc.updated_at
      FROM wa_campaign_contacts cc
      JOIN wa_campaigns c ON c.id = cc.campaign_id
      WHERE c.salon_id = $1
        AND cc.status != 'PENDING'
        ${campaignFilter}
      ORDER BY cc.updated_at DESC
      LIMIT 50
    `, params)
    return rows
  },
}
