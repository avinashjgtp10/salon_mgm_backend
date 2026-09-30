import pool from '../../../../config/database'
import { v4 as uuid } from 'uuid'
import { WAConversation, WAMessage } from './inbox.types'
import { clientPhoneKey } from '../../../clients/clients.phone'

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

    // Sending a reply is not the same as reading the conversation — only
    // markConversationRead() (triggered by actually opening the chat) should
    // clear unread_count. Previously this zeroed it out on every outbound
    // send, hiding unread messages the staff never actually viewed.
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
                            ELSE wa_conversations.unread_count
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

  // ── Customer Info panel (Inbox sidebar) ───────────────────────────────────
  // Matched on clientPhoneKey (last 10 digits) — the same normalizer the
  // Clients module itself uses for "is this the same person" — so a
  // conversation phone stored as "+919876543210" still matches a client row
  // saved as "9876543210" or "09876543210".
  async findCustomerInfoByPhone(salonId: string, phone: string) {
    const key = clientPhoneKey(phone)
    if (!key) return null
    // total_visits/last_visit_date are computed live from appointments here,
    // NOT read off clients.total_visits/last_visit_date — the former drifts
    // (an incrementing counter, same known issue as wa_campaigns' own stale
    // sent_count) and the latter is dead: no code anywhere in this codebase
    // ever writes to clients.last_visit_date, so it's always NULL. This
    // matches the same live-appointments pattern clients.service.ts already
    // uses for its own History tab.
    const { rows } = await pool.query(`
      SELECT
        c.id, c.full_name, c.phone_number,
        COALESCE(appt.total_visits, 0) AS total_visits,
        appt.last_visit_date,
        COALESCE(pay.lifetime_spend, 0) AS lifetime_spend,
        cm.membership_name
      FROM clients c
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE a.status IN ('paid', 'partial'))::int AS total_visits,
          MAX(a.scheduled_at) FILTER (WHERE a.status IN ('paid', 'partial')) AS last_visit_date
        FROM appointments a
        WHERE a.client_id = c.id AND a.deleted_at IS NULL
      ) appt ON true
      LEFT JOIN LATERAL (
        SELECT SUM(py.paid_amount) AS lifetime_spend
        FROM payments py
        WHERE py.client_id = c.id AND py.status IN ('completed', 'partial')
      ) pay ON true
      LEFT JOIN client_memberships cm ON cm.client_id = c.id AND cm.status = 'active'
      WHERE c.salon_id = $1
        AND RIGHT(REGEXP_REPLACE(COALESCE(c.phone_number, ''), '[^0-9]', '', 'g'), 10) = $2
      LIMIT 1
    `, [salonId, key])
    return rows[0] ?? null
  },
}