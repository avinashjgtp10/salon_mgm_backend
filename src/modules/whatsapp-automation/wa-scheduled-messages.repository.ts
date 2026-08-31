// ============================================================
// SalonOx — Scheduled Templates (wa_scheduled_messages) Repository
// ============================================================

import pool from '../../config/database'
import {
  AutomationEventType,
  ScheduledMessage,
  ScheduledMessageStatus,
  UpsertScheduledParams,
  ListScheduledMessagesFilters,
} from './whatsapp-automation.types'

export const waScheduledMessagesRepository = {

  // The one INSERT-or-move method — every Group A insertion point and Group
  // B's nightly upsert both call this. Relies on the partial unique index
  // uq_wa_sched_live_reference (reference_type, reference_id, event_type)
  // WHERE status='SCHEDULED' — a second call for the same reference simply
  // moves scheduled_at/variables instead of creating a duplicate, which is
  // what makes "reschedule" and "create if missing" the same code path.
  async upsertScheduled(params: UpsertScheduledParams): Promise<ScheduledMessage> {
    const { rows } = await pool.query(
      `INSERT INTO wa_scheduled_messages
         (salon_id, client_id, phone_number, phone_country_code, event_type,
          reference_id, reference_type, scheduled_at, variables, message_preview, is_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (reference_type, reference_id, event_type) WHERE status = 'SCHEDULED'
       DO UPDATE SET
         scheduled_at    = EXCLUDED.scheduled_at,
         variables       = EXCLUDED.variables,
         message_preview = EXCLUDED.message_preview,
         updated_at      = NOW()
       RETURNING *`,
      [
        params.salonId,
        params.clientId ?? null,
        params.phone,
        params.countryCode ?? null,
        params.eventType,
        params.referenceId,
        params.referenceType,
        params.scheduledAt,
        JSON.stringify(params.variables ?? {}),
        params.messagePreview,
        params.isPreview ?? false,
      ]
    )
    return rows[0]
  },

  // Atomic claim — SKIP LOCKED so concurrent poller ticks (or a manual
  // Send Now racing the poller) never both grab the same row.
  async claimDue(limit = 200): Promise<ScheduledMessage[]> {
    const { rows } = await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'SENDING', updated_at = NOW()
       WHERE id IN (
         SELECT id FROM wa_scheduled_messages
         WHERE status = 'SCHEDULED' AND scheduled_at <= NOW()
         ORDER BY scheduled_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [limit]
    )
    return rows
  },

  // Used by Send Now / Retry Now — claims one specific row regardless of
  // scheduled_at, but only from an allowed starting status (enforced by the
  // caller passing the right fromStatuses).
  async claimById(id: string, salonId: string, fromStatuses: ScheduledMessageStatus[]): Promise<ScheduledMessage | null> {
    const { rows } = await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'SENDING', updated_at = NOW()
       WHERE id = $1 AND salon_id = $2 AND status = ANY($3::text[])
       RETURNING *`,
      [id, salonId, fromStatuses]
    )
    return rows[0] ?? null
  },

  async markSent(id: string, automationLogId: string | null): Promise<void> {
    await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'SENT', sent_at = NOW(), automation_log_id = $2,
           attempt_count = attempt_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [id, automationLogId]
    )
  },

  // Late correction: the row was already marked SENT right after Meta's
  // initial "accepted" response, but a delivery-status webhook has now told
  // us the send actually failed (e.g. a Meta-side engagement throttle) —
  // only ever downgrades a still-SENT row, never touches one a human has
  // since acted on (Resend, etc.) or that was never SENT in the first place.
  async markFailedByLogId(automationLogId: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'FAILED', failure_reason = $2, updated_at = NOW()
       WHERE automation_log_id = $1 AND status = 'SENT'`,
      [automationLogId, reason]
    )
  },

  async markFailed(id: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'FAILED', failure_reason = $2,
           attempt_count = attempt_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [id, reason]
    )
  },

  async markSkipped(id: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'SKIPPED', failure_reason = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, reason]
    )
  },

  // Safety net: a row can be left in SENDING forever if the process restarts
  // (or crashes) mid-retry — trigger()'s own backoff loop lives only in
  // memory, so there's nothing to resume it. sendWithRetry's own attempts
  // top out at ~21 minutes total, so anything still SENDING well past that
  // is orphaned, not just slow. Reset it to FAILED so Retry Now can pick it
  // back up instead of it being stuck with no valid transition forever.
  async reapStaleSending(staleMinutes = 30): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'FAILED', failure_reason = 'Send timed out — process may have restarted mid-send', updated_at = NOW()
       WHERE status = 'SENDING' AND updated_at < NOW() - ($1 || ' minutes')::interval`,
      [staleMinutes]
    )
    return rowCount ?? 0
  },

  async markCancelled(id: string): Promise<void> {
    await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    )
  },

  async findById(id: string, salonId: string): Promise<ScheduledMessage | null> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_scheduled_messages WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    )
    return rows[0] ?? null
  },

  async findByReference(referenceType: string, referenceId: string, eventType?: AutomationEventType): Promise<ScheduledMessage[]> {
    const values: any[] = [referenceType, referenceId]
    let where = `reference_type = $1 AND reference_id = $2 AND status = 'SCHEDULED'`
    if (eventType) { values.push(eventType); where += ` AND event_type = $3` }
    const { rows } = await pool.query(`SELECT * FROM wa_scheduled_messages WHERE ${where}`, values)
    return rows
  },

  // Only ever touches status='SCHEDULED' rows — never resurrects a row a
  // staff member already explicitly Cancelled, or one already Sent/Failed.
  async rescheduleByReference(referenceType: string, referenceId: string, eventType: AutomationEventType, newScheduledAt: Date | string): Promise<void> {
    await pool.query(
      `UPDATE wa_scheduled_messages
       SET scheduled_at = $4, updated_at = NOW()
       WHERE reference_type = $1 AND reference_id = $2 AND event_type = $3 AND status = 'SCHEDULED'`,
      [referenceType, referenceId, eventType, newScheduledAt]
    )
  },

  // API-driven reschedule (Reschedule action on a specific row) — moves this
  // exact row by id, allowed from SCHEDULED or FAILED (a failed send can be
  // pushed to a later retry time same as a still-pending one).
  async rescheduleById(id: string, salonId: string, newScheduledAt: Date | string): Promise<ScheduledMessage | null> {
    const { rows } = await pool.query(
      `UPDATE wa_scheduled_messages
       SET scheduled_at = $3, status = 'SCHEDULED', failure_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND salon_id = $2 AND status IN ('SCHEDULED', 'FAILED')
       RETURNING *`,
      [id, salonId, newScheduledAt]
    )
    return rows[0] ?? null
  },

  // event_type optional — omitting it cancels every live scheduled row tied
  // to this reference (e.g. cancelling an appointment cancels both its
  // service_reminder_24h and package_appointment_reminder_24h rows in one call).
  async cancelByReference(referenceType: string, referenceId: string, eventType?: AutomationEventType): Promise<void> {
    const values: any[] = [referenceType, referenceId]
    let where = `reference_type = $1 AND reference_id = $2 AND status = 'SCHEDULED'`
    if (eventType) { values.push(eventType); where += ` AND event_type = $3` }
    await pool.query(
      `UPDATE wa_scheduled_messages SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW() WHERE ${where}`,
      values
    )
  },

  async list(filters: ListScheduledMessagesFilters): Promise<{ data: ScheduledMessage[]; total: number }> {
    const page   = Math.max(1, parseInt(String(filters.page  ?? 1))  || 1)
    const limit  = Math.min(100, Math.max(1, parseInt(String(filters.limit ?? 20)) || 20))
    const offset = (page - 1) * limit

    const conditions: string[] = ['salon_id = $1']
    const values: any[] = [filters.salonId]
    let idx = 2

    if (filters.status)    { conditions.push(`status = $${idx++}`);     values.push(filters.status) }
    if (filters.eventType) { conditions.push(`event_type = $${idx++}`); values.push(filters.eventType) }
    if (filters.clientId)  { conditions.push(`client_id = $${idx++}`);  values.push(filters.clientId) }
    if (filters.dateFrom)  { conditions.push(`scheduled_at >= $${idx++}::date`); values.push(filters.dateFrom) }
    if (filters.dateTo)    { conditions.push(`scheduled_at < ($${idx++}::date + interval '1 day')`); values.push(filters.dateTo) }
    if (filters.search?.trim()) {
      conditions.push(`phone_number ILIKE $${idx}`)
      values.push(`%${filters.search.trim()}%`)
      idx++
    }

    const where = conditions.join(' AND ')

    const countRes = await pool.query(`SELECT COUNT(*) FROM wa_scheduled_messages WHERE ${where}`, values)
    const dataRes  = await pool.query(
      `SELECT * FROM wa_scheduled_messages WHERE ${where} ORDER BY scheduled_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    )

    return { data: dataRes.rows, total: parseInt(countRes.rows[0].count) }
  },

  // Group B's overnight cleanup — deletes a preview event type's still-
  // SCHEDULED rows whose reference is no longer in today's candidate list
  // (the underlying condition resolved: balance paid, client came back).
  async deleteStalePreview(eventType: AutomationEventType, currentReferenceIds: string[]): Promise<void> {
    if (currentReferenceIds.length === 0) {
      await pool.query(
        `DELETE FROM wa_scheduled_messages WHERE event_type = $1 AND is_preview = true AND status = 'SCHEDULED'`,
        [eventType]
      )
      return
    }
    await pool.query(
      `DELETE FROM wa_scheduled_messages
       WHERE event_type = $1 AND is_preview = true AND status = 'SCHEDULED'
         AND reference_id != ALL($2::uuid[])`,
      [eventType, currentReferenceIds]
    )
  },
}
