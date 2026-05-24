import pool from '../../../../config/database'
import { v4 as uuid } from 'uuid'
import { WAConversation, WAMessage } from './inbox.types'

// ── Normalize phone to E.164 format — second layer of defense ─────────────────
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '')
  if (phone.startsWith('+'))                           return '+' + digits
  if (digits.length === 10)                            return '+91' + digits
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  return '+' + digits
}

export const inboxRepository = {

  // ── Conversations ─────────────────────────────────────────────────────────

  async upsertConversation(
    salonId:     string,
    phone:       string,
    name:        string | null,
    lastMessage: string,
    isInbound:   boolean
  ): Promise<string> {
    const normalizedPhone = normalizePhone(phone)   // ← normalize before insert

    const { rows } = await pool.query(`
      INSERT INTO wa_conversations
        (id, salon_id, contact_phone, contact_name, last_message, last_message_at, unread_count)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      ON CONFLICT (salon_id, contact_phone) DO UPDATE SET
        contact_name    = COALESCE(EXCLUDED.contact_name, wa_conversations.contact_name),
        last_message    = EXCLUDED.last_message,
        last_message_at = NOW(),
        unread_count    = CASE
                            WHEN $6 = 1 THEN wa_conversations.unread_count + 1
                            ELSE 0
                          END,
        updated_at      = NOW()
      RETURNING id
    `, [uuid(), salonId, normalizedPhone, name, lastMessage, isInbound ? 1 : 0])
    return rows[0].id
  },

  async getConversations(salonId: string): Promise<WAConversation[]> {
    const { rows } = await pool.query(`
      SELECT id, contact_phone, contact_name, last_message, last_message_at, unread_count
      FROM wa_conversations
      WHERE salon_id = $1
      ORDER BY last_message_at DESC NULLS LAST
    `, [salonId])
    return rows
  },

  async findConversation(salonId: string, phone: string): Promise<WAConversation | null> {
    const normalizedPhone = normalizePhone(phone)   // ← normalize
    const { rows } = await pool.query(`
      SELECT id, contact_phone, contact_name, last_message, last_message_at, unread_count
      FROM wa_conversations
      WHERE salon_id = $1 AND contact_phone = $2
    `, [salonId, normalizedPhone])
    return rows[0] || null
  },

  async markConversationRead(salonId: string, phone: string): Promise<void> {
    const normalizedPhone = normalizePhone(phone)   // ← normalize
    await pool.query(`
      UPDATE wa_conversations
      SET unread_count = 0, updated_at = NOW()
      WHERE salon_id = $1 AND contact_phone = $2
    `, [salonId, normalizedPhone])
  },

  // ── Messages ──────────────────────────────────────────────────────────────

  async insertMessage(params: {
    conversationId: string
    salonId:        string
    direction:      'INBOUND' | 'OUTBOUND'
    body:           string
    wamid:          string | null
    status:         string
    mediaType?:     string | null
    mediaUrl?:      string | null
  }): Promise<WAMessage> {
    const { rows } = await pool.query(`
      INSERT INTO wa_messages
        (id, conversation_id, salon_id, direction, body, wamid, status, media_type, media_url, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `, [
      uuid(),
      params.conversationId,
      params.salonId,
      params.direction,
      params.body,
      params.wamid,
      params.status,
      params.mediaType ?? null,
      params.mediaUrl  ?? null,
    ])
    return rows[0]
  },

  async getMessages(salonId: string, phone: string): Promise<WAMessage[]> {
    const normalizedPhone = normalizePhone(phone)   // ← normalize
    const { rows } = await pool.query(`
      SELECT
        m.id, m.conversation_id, m.direction, m.body,
        m.wamid, m.status, m.media_type, m.media_url,
        m.sent_at, m.delivered_at, m.read_at
      FROM wa_messages m
      JOIN wa_conversations c ON c.id = m.conversation_id
      WHERE c.salon_id = $1 AND c.contact_phone = $2
      ORDER BY m.sent_at ASC
    `, [salonId, normalizedPhone])
    return rows
  },

  async updateMessageStatus(
    wamid:        string,
    status:       string,
    timestampCol: 'delivered_at' | 'read_at',
    timestamp:    Date
  ): Promise<void> {
    // COALESCE — never overwrite an existing timestamp
    await pool.query(`
      UPDATE wa_messages
      SET
        status          = $1,
        ${timestampCol} = COALESCE(${timestampCol}, $2)
      WHERE wamid = $3
    `, [status, timestamp, wamid])
  },
}