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

// WHERE for the History queries — aliased `l` so the list query can join clients. Owner-facing alerts and unsent
// (QUEUED) rows are excluded; dates are inclusive days on the time the message went out (or was attempted).
function historyWhere(params: { salonId: string; dateFrom?: string; dateTo?: string }): { where: string; values: any[] } {
  const conditions = [
    'l.salon_id = $1',
    `l.status <> 'QUEUED'`,
    `l.event_type NOT IN ('cash_counter_opened','cash_counter_closed','cash_counter_opened_updated','cash_counter_closed_updated')`,
  ]
  const values: any[] = [params.salonId]
  if (params.dateFrom) { values.push(params.dateFrom); conditions.push(`COALESCE(l.sent_at, l.created_at) >= $${values.length}::date`) }
  if (params.dateTo)   { values.push(params.dateTo);   conditions.push(`COALESCE(l.sent_at, l.created_at) < ($${values.length}::date + interval '1 day')`) }
  return { where: conditions.join(' AND '), values }
}

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

  // ── History ────────────────────────────────────────────────────────────────
  // What was actually sent to clients, read from wa_automation_logs — the one table every WhatsApp automation message
  // lands in (scheduled ones and the instant ones such as bill receipts), so the counts cover every template.
  // Messages to the salon OWNER (cash counter alerts) are left out: this is about clients.
  // QUEUED rows have not gone out yet and are not history.
  async historySummary(params: { salonId: string; dateFrom?: string; dateTo?: string }): Promise<{
    byEvent: { event_type: string; total: number; sent: number; delivered: number; read: number; failed: number; skipped: number }[]
  }> {
    const { where, values } = historyWhere(params)
    const { rows } = await pool.query(
      `SELECT l.event_type,
              COUNT(*)::int                                                      AS total,
              COUNT(*) FILTER (WHERE l.status IN ('SENT','DELIVERED','READ'))::int AS sent,
              COUNT(*) FILTER (WHERE l.status IN ('DELIVERED','READ'))::int        AS delivered,
              COUNT(*) FILTER (WHERE l.status = 'READ')::int                       AS read,
              COUNT(*) FILTER (WHERE l.status = 'FAILED')::int                     AS failed,
              COUNT(*) FILTER (WHERE l.status = 'SKIPPED')::int                    AS skipped
       FROM wa_automation_logs l
       WHERE ${where}
       GROUP BY l.event_type
       ORDER BY total DESC`,
      values
    )
    return { byEvent: rows }
  },

  async historyList(params: {
    salonId: string; dateFrom?: string; dateTo?: string
    eventType?: string[]; status?: string[]; search?: string; page?: number; limit?: number
  }): Promise<{ data: any[]; total: number }> {
    const page   = Math.max(1, parseInt(String(params.page  ?? 1))  || 1)
    const limit  = Math.min(100, Math.max(1, parseInt(String(params.limit ?? 20)) || 20))
    const offset = (page - 1) * limit

    const { where: base, values } = historyWhere(params)
    const conditions = [base]
    let idx = values.length + 1
    if (params.eventType?.length) { conditions.push(`l.event_type = ANY($${idx++}::text[])`); values.push(params.eventType) }
    if (params.status?.length)    { conditions.push(`l.status = ANY($${idx++}::text[])`);     values.push(params.status) }
    if (params.search?.trim()) {
      conditions.push(`(l.phone_number ILIKE $${idx} OR c.full_name ILIKE $${idx})`)
      values.push(`%${params.search.trim()}%`)
      idx++
    }
    const where = conditions.join(' AND ')

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM wa_automation_logs l LEFT JOIN clients c ON c.id = l.client_id WHERE ${where}`, values)
    const dataRes = await pool.query(
      `SELECT l.id, l.event_type, l.template_name, l.status, l.phone_number, l.failure_reason,
              l.sent_at, l.delivered_at, l.read_at, l.created_at,
              c.full_name AS client_name
       FROM wa_automation_logs l
       LEFT JOIN clients c ON c.id = l.client_id
       WHERE ${where}
       ORDER BY COALESCE(l.sent_at, l.created_at) DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    )
    return { data: dataRes.rows, total: countRes.rows[0].n }
  },

  async list(filters: ListScheduledMessagesFilters): Promise<{ data: ScheduledMessage[]; total: number }> {
    const page   = Math.max(1, parseInt(String(filters.page  ?? 1))  || 1)
    const limit  = Math.min(100, Math.max(1, parseInt(String(filters.limit ?? 20)) || 20))
    const offset = (page - 1) * limit

    const conditions: string[] = ['salon_id = $1']
    const values: any[] = [filters.salonId]
    let idx = 2

    // Both accept a single value or an array — a checkbox filter with several
    // boxes ticked (e.g. Scheduled + Failed) must OR them together, not
    // silently collapse to whichever was picked last.
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
      if (statuses.length) { conditions.push(`status = ANY($${idx++}::text[])`); values.push(statuses) }
    }
    if (filters.eventType) {
      const eventTypes = Array.isArray(filters.eventType) ? filters.eventType : [filters.eventType]
      if (eventTypes.length) { conditions.push(`event_type = ANY($${idx++}::text[])`); values.push(eventTypes) }
    }
    if (filters.clientId)  { conditions.push(`client_id = $${idx++}`);  values.push(filters.clientId) }
    if (filters.dateFrom)  { conditions.push(`scheduled_at >= $${idx++}::date`); values.push(filters.dateFrom) }
    if (filters.dateTo)    { conditions.push(`scheduled_at < ($${idx++}::date + interval '1 day')`); values.push(filters.dateTo) }
    if (filters.search?.trim()) {
      conditions.push(`phone_number ILIKE $${idx}`)
      values.push(`%${filters.search.trim()}%`)
      idx++
    }

    const where = conditions.join(' AND ')

    // The list is the union of the automation messages and the Service Chain follow-ups (which live in their own tables and
    // are sent by their own runner). Chain rows are read-only here (source = 'service_chain'): they are changed from
    // Service Chains, not from this page. Chain statuses are folded into this page's set (POSTPONED -> SCHEDULED,
    // DELIVERED/READ -> SENT). Only the columns the page uses are selected, so this does not depend on the later chain
    // migrations having been run.
    const SOURCE = `(
      SELECT id, salon_id, client_id, phone_number, phone_country_code, event_type, reference_id::text AS reference_id,
             reference_type, scheduled_at, status, message_preview, failure_reason, attempt_count, sent_at, created_at,
             updated_at, 'scheduled'::text AS source
      FROM wa_scheduled_messages
      UNION ALL
      SELECT m.id, m.salon_id, e.client_id, c.phone_number, c.phone_country_code, 'service_chain'::text AS event_type,
             e.id::text AS reference_id, 'service_chain'::text AS reference_type, m.scheduled_at,
             CASE m.status WHEN 'POSTPONED' THEN 'SCHEDULED' WHEN 'DELIVERED' THEN 'SENT' WHEN 'READ' THEN 'SENT' ELSE m.status END AS status,
             'Service Chain: ' || ch.name || COALESCE(' - ' || t.name, '') AS message_preview,
             COALESCE(m.error_message, m.skip_reason) AS failure_reason, 0 AS attempt_count, m.sent_at, m.created_at,
             m.updated_at, 'service_chain'::text AS source
      FROM service_chain_messages m
      JOIN service_chain_enrolments e ON e.id = m.enrolment_id
      JOIN service_chains ch ON ch.id = e.chain_id AND ch.deleted_at IS NULL
      JOIN service_chain_steps st ON st.id = m.step_id
      JOIN clients c ON c.id = e.client_id
      LEFT JOIN wa_templates t ON t.id = st.template_id
    ) all_scheduled`

    const countRes = await pool.query(`SELECT COUNT(*) FROM ${SOURCE} WHERE ${where}`, values)
    // What's coming up first (soonest due at the very top — today before
    // next week), then what's already happened last (most recent first —
    // yesterday before last month). A plain chronological sort would bury
    // today's due-soon rows under anything scheduled further in the future.
    const dataRes  = await pool.query(
      `SELECT * FROM ${SOURCE} WHERE ${where}
       ORDER BY
         CASE WHEN scheduled_at >= NOW() THEN 0 ELSE 1 END,
         CASE WHEN scheduled_at >= NOW() THEN scheduled_at END ASC,
         CASE WHEN scheduled_at <  NOW() THEN scheduled_at END DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    )

    return { data: dataRes.rows, total: parseInt(countRes.rows[0].count) }
  },

  // Service "time to redo" reminders (services.reminder_after_days): one row per
  // service line of an appointment that was paid in the last 2 days, whose
  // service has a reminder configured, and that has never been scheduled before
  // (any status - so a SENT or CANCELLED one is not recreated). The line's own
  // id is the reference, which is what keeps two lines of one visit apart.
  async findPaidServiceLinesForRedo(limit = 500): Promise<Array<{
    appointment_id: string; salon_id: string; client_id: string; paid_at: Date
    row_id: string; service_id: string; service_name: string; reminder_after_days: number
    client_name: string | null; phone: string; country_code: string | null; salon_name: string | null
  }>> {
    const { rows } = await pool.query(
      `SELECT a.id AS appointment_id, a.salon_id, a.client_id, a.updated_at AS paid_at,
              item->>'id' AS row_id, item->>'service_id' AS service_id,
              COALESCE(NULLIF(item->>'name', ''), sv.name) AS service_name,
              sv.reminder_after_days,
              c.full_name AS client_name, c.phone_number AS phone, c.phone_country_code AS country_code,
              sal.business_name AS salon_name
       FROM appointments a
       JOIN clients c   ON c.id = a.client_id
       JOIN salons sal  ON sal.id = a.salon_id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS item
       JOIN services sv ON sv.id::text = item->>'service_id' AND sv.salon_id = a.salon_id
       WHERE a.status = 'paid' AND a.deleted_at IS NULL
         AND a.updated_at > NOW() - INTERVAL '2 days'
         AND sv.reminder_after_days IS NOT NULL AND sv.reminder_after_days > 0
         AND (item->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND COALESCE(c.phone_number, '') <> ''
         AND NOT EXISTS (
           SELECT 1 FROM wa_scheduled_messages m
           WHERE m.reference_type = 'appointment_service'
             AND m.event_type = 'service_redo_reminder'
             AND m.reference_id::text = item->>'id'
         )
       ORDER BY a.updated_at
       LIMIT $1`,
      [limit]
    )
    return rows
  },

  // A repeat visit makes an earlier pending "time to redo" for the same client and
  // service pointless - cancel it. Matched on the preview text, which carries the
  // service name (variables only hold the positional Meta values).
  async cancelPendingRedoForClientService(salonId: string, clientId: string, messagePreview: string, exceptReferenceId: string): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE wa_scheduled_messages
       SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
       WHERE salon_id = $1 AND client_id = $2 AND event_type = 'service_redo_reminder'
         AND status = 'SCHEDULED' AND message_preview = $3 AND reference_id::text <> $4`,
      [salonId, clientId, messagePreview, exceptReferenceId]
    )
    return rowCount ?? 0
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
