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

  // Deletes whole conversations (the thread and every message in it) for this salon. Returns how many
  // conversations were removed. Messages go first, in the same transaction, so nothing is left dangling.
  // A customer who writes again later simply starts a fresh conversation.
  async deleteConversations(salonId: string, phones: string[]): Promise<number> {
    const normalized = phones.map(normalizePhone)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `SELECT id FROM wa_conversations WHERE salon_id = $1 AND contact_phone = ANY($2::text[])`,
        [salonId, normalized]
      )
      const ids: string[] = rows.map((r: any) => r.id)
      if (ids.length > 0) {
        await client.query(`DELETE FROM wa_messages WHERE conversation_id = ANY($1::uuid[])`, [ids])
        await client.query(`DELETE FROM wa_conversations WHERE id = ANY($1::uuid[]) AND salon_id = $2`, [ids, salonId])
      }
      await client.query('COMMIT')
      return ids.length
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* connection may already be dead */ }
      throw err
    } finally {
      client.release()
    }
  },

  // Just the total — powers the sidebar's unread badge without shipping the
  // whole conversation list on every page.
  async getUnreadTotal(salonId: string): Promise<number> {
    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(unread_count), 0)::int AS total
      FROM wa_conversations
      WHERE salon_id = $1
    `, [salonId])
    return rows[0]?.total ?? 0
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

  // Newest message the customer sent us — the one a read receipt / typing
  // indicator has to reference. status lets callers skip an already-read one.
  async getLatestInbound(salonId: string, phone: string): Promise<{ wamid: string; status: string | null } | null> {
    const { rows } = await pool.query(`
      SELECT m.wamid, m.status
      FROM wa_messages m
      JOIN wa_conversations c ON c.id = m.conversation_id
      WHERE c.salon_id = $1 AND c.contact_phone = $2
        AND m.direction = 'INBOUND' AND m.wamid IS NOT NULL
      ORDER BY m.sent_at DESC
      LIMIT 1
    `, [salonId, normalizePhone(phone)])
    return rows[0] ?? null
  },

  async getMessages(salonId: string, phone: string): Promise<WAMessage[]> {
    const normalizedPhone = normalizePhone(phone)   // ← normalize
    const { rows } = await pool.query(`
      SELECT
        m.id, m.conversation_id, m.direction, m.body,
        m.wamid, m.status, m.media_type, m.media_url,
        m.sent_at, m.delivered_at, m.read_at,
        to_jsonb(m)->>'reaction' AS reaction
      FROM wa_messages m
      JOIN wa_conversations c ON c.id = m.conversation_id
      WHERE c.salon_id = $1 AND c.contact_phone = $2
      ORDER BY m.sent_at ASC
    `, [salonId, normalizedPhone])
    return rows
  },

  // When the customer last wrote to us (null = never) - the start of the 24h window.
  async getLastInboundAt(salonId: string, phone: string): Promise<Date | null> {
    const { rows } = await pool.query(`
      SELECT MAX(m.sent_at) AS t
      FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
      WHERE c.salon_id = $1 AND c.contact_phone = $2 AND m.direction = 'INBOUND'
    `, [salonId, phone])
    return rows[0]?.t ? new Date(rows[0].t) : null
  },

  // One message with the phone of its conversation - what a reaction needs.
  async findMessageForReaction(salonId: string, messageId: string): Promise<{ id: string; wamid: string | null; contact_phone: string } | null> {
    const { rows } = await pool.query(`
      SELECT m.id, m.wamid, c.contact_phone
      FROM wa_messages m JOIN wa_conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.salon_id = $2
    `, [messageId, salonId])
    return rows[0] ?? null
  },

  // Remembers a reaction. reaction column comes from Migration/add_wa_messages_reaction.sql;
  // before that runs this quietly does nothing (the reaction still went to WhatsApp).
  async setReaction(by: { id?: string; wamid?: string }, emoji: string): Promise<{ contact_phone: string; wamid: string | null } | null> {
    try {
      const { rows } = await pool.query(`
        UPDATE wa_messages m SET reaction = NULLIF($1, '')
        FROM wa_conversations c
        WHERE c.id = m.conversation_id AND ${by.id ? 'm.id = $2' : 'm.wamid = $2'}
        RETURNING c.contact_phone, m.wamid
      `, [emoji, by.id ?? by.wamid])
      return rows[0] ?? null
    } catch (err: any) {
      if (err?.code === '42703') return null   // undefined_column: migration not run yet
      throw err
    }
  },

  // Delivery receipt from Meta for a message we sent from the Inbox. Only ever
  // moves a message forward (SENT -> DELIVERED -> READ, or SENT -> FAILED), so a
  // late/duplicate callback can't downgrade it.
  async applyDeliveryStatus(wamid: string, status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED', at: Date): Promise<void> {
    await pool.query(`
      UPDATE wa_messages SET
        status       = $1,
        delivered_at = CASE WHEN $1 IN ('DELIVERED','READ') THEN COALESCE(delivered_at, $2) ELSE delivered_at END,
        read_at      = CASE WHEN $1 = 'READ' THEN COALESCE(read_at, $2) ELSE read_at END
      WHERE wamid = $3 AND direction = 'OUTBOUND'
        AND (CASE COALESCE(status,'SENT') WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 0 END)
          < (CASE $1 WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 ELSE 2 END)
    `, [status, at, wamid])
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
        c.id, c.full_name, c.phone_number, c.avatar_url,
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