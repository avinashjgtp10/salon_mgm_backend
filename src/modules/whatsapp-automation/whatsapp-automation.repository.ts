// ============================================================
// SalonOx — WhatsApp Automation Repository
// ============================================================

import pool from '../../config/database'
import {
  AutomationLog,
  AutomationLogStatus,
  AutomationEventType,
  AutomationTemplate,
  ListAutomationLogsFilters,
  UpdateSalonAutomationSettingBody,
  PURCHASE_EVENTS,
} from './whatsapp-automation.types'
import { DEFAULT_PURCHASE_TEMPLATES, isPurchaseEventType } from './wa-automation-defaults'

export const whatsappAutomationRepository = {

  // ── Global Template Config ────────────────────────────────────────────────
  // Legacy events (salon_id IS NULL): one row per event type, same for all
  // salons. Purchase events: each salon owns its own row, submitted to Meta
  // under their own WABA — only an APPROVED salon row is ever sent from,
  // never a fallback to a global row (a template approved under one salon's
  // WABA can't be used to send from another salon's phone number).
  async findTemplate(eventType: AutomationEventType, salonId?: string): Promise<AutomationTemplate | null> {
    if (salonId) {
      const { rows } = await pool.query(
        `SELECT * FROM wa_automation_templates
         WHERE event_type = $1 AND salon_id = $2 AND is_active = TRUE AND status = 'APPROVED'`,
        [eventType, salonId]
      )
      if (rows[0]) return rows[0]
      if (PURCHASE_EVENTS.includes(eventType)) return null
    }
    const { rows } = await pool.query(
      `SELECT * FROM wa_automation_templates
       WHERE event_type = $1 AND salon_id IS NULL AND is_active = TRUE`,
      [eventType]
    )
    return rows[0] ?? null
  },

  // Legacy global rows only (salon_id IS NULL) — admin-managed reminders/
  // campaigns. Purchase-event salon rows are managed via the methods below,
  // never through these admin endpoints, now that event_type alone isn't unique.
  async findAllTemplates(): Promise<AutomationTemplate[]> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_automation_templates WHERE salon_id IS NULL ORDER BY event_type`
    )
    return rows
  },

  async updateTemplateName(eventType: AutomationEventType, templateName: string, language: string): Promise<AutomationTemplate> {
    const { rows } = await pool.query(
      `UPDATE wa_automation_templates
       SET template_name = $1, language = $2, updated_at = NOW()
       WHERE event_type = $3 AND salon_id IS NULL
       RETURNING *`,
      [templateName, language, eventType]
    )
    if (!rows[0]) throw new Error(`AutomationTemplate not found for eventType=${eventType}`)
    return rows[0]
  },

  async toggleTemplate(eventType: AutomationEventType, isActive: boolean): Promise<AutomationTemplate> {
    const { rows } = await pool.query(
      `UPDATE wa_automation_templates
       SET is_active = $1, updated_at = NOW()
       WHERE event_type = $2 AND salon_id IS NULL
       RETURNING *`,
      [isActive, eventType]
    )
    if (!rows[0]) throw new Error(`AutomationTemplate not found for eventType=${eventType}`)
    return rows[0]
  },

  // ── Salon Purchase Templates (salon-owner editable, Meta-submitted) ────────
  // One row per (salon_id, event_type) for the 4 PURCHASE_EVENTS — lazily
  // seeded from DEFAULT_PURCHASE_TEMPLATES on first access.
  async findOrSeedSalonPurchaseTemplate(salonId: string, eventType: AutomationEventType): Promise<AutomationTemplate> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_automation_templates WHERE salon_id = $1 AND event_type = $2`,
      [salonId, eventType]
    )
    if (rows[0]) return rows[0]
    if (!isPurchaseEventType(eventType)) throw new Error(`Not a purchase event type: ${eventType}`)

    const defaults = DEFAULT_PURCHASE_TEMPLATES[eventType]
    const { rows: inserted } = await pool.query(
      `INSERT INTO wa_automation_templates
         (salon_id, event_type, template_name, language, is_active, status, category, body_text)
       VALUES ($1, $2, $3, $4, TRUE, 'DRAFT', $5, $6)
       ON CONFLICT (salon_id, event_type) WHERE salon_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [salonId, eventType, `${eventType}_draft`, defaults.language, defaults.category, defaults.bodyText]
    )
    if (inserted[0]) return inserted[0]

    // Lost a race with a concurrent request that seeded the row first.
    const { rows: retry } = await pool.query(
      `SELECT * FROM wa_automation_templates WHERE salon_id = $1 AND event_type = $2`,
      [salonId, eventType]
    )
    return retry[0]
  },

  async findAllSalonPurchaseTemplates(salonId: string): Promise<AutomationTemplate[]> {
    const results: AutomationTemplate[] = []
    for (const eventType of PURCHASE_EVENTS) {
      results.push(await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType))
    }
    return results
  },

  async upsertDraftTemplate(salonId: string, eventType: AutomationEventType, bodyText: string): Promise<AutomationTemplate> {
    await whatsappAutomationRepository.findOrSeedSalonPurchaseTemplate(salonId, eventType)
    const { rows } = await pool.query(
      `UPDATE wa_automation_templates
       SET body_text = $1, updated_at = NOW()
       WHERE salon_id = $2 AND event_type = $3 AND status IN ('DRAFT', 'REJECTED')
       RETURNING *`,
      [bodyText, salonId, eventType]
    )
    if (!rows[0]) throw new Error('Template wording can only be edited while in DRAFT or REJECTED status')
    return rows[0]
  },

  async markSubmitted(
    salonId: string,
    eventType: AutomationEventType,
    templateName: string,
    metaTemplateId: string | undefined,
    status: 'PENDING' | 'APPROVED'
  ): Promise<AutomationTemplate> {
    const { rows } = await pool.query(
      `UPDATE wa_automation_templates
       SET template_name = $1, meta_template_id = $2, status = $3, rejection_reason = NULL, updated_at = NOW()
       WHERE salon_id = $4 AND event_type = $5
       RETURNING *`,
      [templateName, metaTemplateId ?? null, status, salonId, eventType]
    )
    if (!rows[0]) throw new Error(`Salon template not found for eventType=${eventType}`)
    return rows[0]
  },

  // Return a salon template to a clean, resubmittable state — used when its
  // Meta-side template was deleted/rejected and needs to be redone. Clears the
  // stale meta_template_id/name (which would otherwise keep failing sends with
  // Meta 132001) and flips back to DRAFT, but PRESERVES body_text so the salon's
  // edited wording survives. Allowed from any status.
  async resetTemplateForResubmission(salonId: string, eventType: AutomationEventType): Promise<AutomationTemplate> {
    const { rows } = await pool.query(
      `UPDATE wa_automation_templates
       SET status = 'DRAFT',
           meta_template_id = NULL,
           rejection_reason = NULL,
           approved_at = NULL,
           template_name = $1,
           updated_at = NOW()
       WHERE salon_id = $2 AND event_type = $3
       RETURNING *`,
      [`${eventType}_draft`, salonId, eventType]
    )
    if (!rows[0]) throw new Error(`Salon template not found for eventType=${eventType}`)
    return rows[0]
  },

  async updateSyncedStatus(
    salonId: string,
    eventType: AutomationEventType,
    status: 'PENDING' | 'APPROVED' | 'REJECTED',
    rejectionReason: string | null
  ): Promise<AutomationTemplate> {
    const { rows } = await pool.query(
      `UPDATE wa_automation_templates
       SET status = $1::varchar,
           rejection_reason = $2,
           approved_at = CASE WHEN $1::varchar = 'APPROVED' THEN NOW() ELSE approved_at END,
           updated_at = NOW()
       WHERE salon_id = $3 AND event_type = $4
       RETURNING *`,
      [status, rejectionReason, salonId, eventType]
    )
    if (!rows[0]) throw new Error(`Salon template not found for eventType=${eventType}`)
    return rows[0]
  },

  // Client's WhatsApp opt-in flags. Returns null if the client can't be found
  // (walk-in / bad id) — caller treats that as "no explicit opt-out, allow".
  async getClientOptIn(clientId: string): Promise<{ notifications: boolean; marketing: boolean } | null> {
    const { rows } = await pool.query(
      `SELECT whatsapp_notifications, whatsapp_marketing FROM clients WHERE id = $1`,
      [clientId]
    )
    if (!rows[0]) return null
    return { notifications: rows[0].whatsapp_notifications !== false, marketing: rows[0].whatsapp_marketing !== false }
  },

  // ── Per-Salon Automation Settings ─────────────────────────────────────────
  // Salons can enable/disable specific automations
  // If no row exists → default is ENABLED
  async isSalonAutomationEnabled(salonId: string, eventType: AutomationEventType): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT is_active FROM wa_salon_automation_settings
       WHERE salon_id = $1 AND event_type = $2`,
      [salonId, eventType]
    )
    // No row = enabled by default
    if (rows.length === 0) return true
    return rows[0].is_active
  },

  async getSalonSettings(salonId: string) {
    const { rows } = await pool.query(
      `SELECT * FROM wa_salon_automation_settings WHERE salon_id = $1 ORDER BY event_type`,
      [salonId]
    )
    return rows
  },

  async upsertSalonSetting(salonId: string, body: UpdateSalonAutomationSettingBody) {
    const { rows } = await pool.query(
      `INSERT INTO wa_salon_automation_settings (salon_id, event_type, is_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (salon_id, event_type)
       DO UPDATE SET is_active = EXCLUDED.is_active, updated_at = NOW()
       RETURNING *`,
      [salonId, body.event_type, body.is_active]
    )
    return rows[0]
  },

  // ── Automation Logs ───────────────────────────────────────────────────────
  async createLog(params: {
    salonId:        string
    clientId?:      string | null
    phone:          string
    eventType:      AutomationEventType
    templateName:   string
    referenceId?:   string | null
    referenceType?: string | null
    status:         AutomationLogStatus
  }): Promise<AutomationLog> {
    const { rows } = await pool.query(
      `INSERT INTO wa_automation_logs
         (salon_id, client_id, phone_number, event_type, template_name,
          reference_id, reference_type, status, attempt_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
       RETURNING *`,
      [
        params.salonId,
        params.clientId      ?? null,
        params.phone,
        params.eventType,
        params.templateName,
        params.referenceId   ?? null,
        params.referenceType ?? null,
        params.status,
      ]
    )
    return rows[0]
  },

  async markSent(logId: string, wamid: string): Promise<void> {
    await pool.query(
      `UPDATE wa_automation_logs
       SET status          = 'SENT',
           meta_message_id = $1,
           sent_at         = NOW(),
           attempt_count   = attempt_count + 1,
           next_retry_at   = NULL,
           updated_at      = NOW()
       WHERE id = $2`,
      [wamid, logId]
    )
  },

  async markFailed(logId: string, reason: string, metaResponse: any, nextRetryAt: Date | null): Promise<void> {
    await pool.query(
      `UPDATE wa_automation_logs
       SET status         = 'FAILED',
           failure_reason = $1,
           meta_response  = $2::jsonb,
           attempt_count  = attempt_count + 1,
           next_retry_at  = $3,
           updated_at     = NOW()
       WHERE id = $4`,
      [reason, JSON.stringify(metaResponse ?? {}), nextRetryAt, logId]
    )
  },

  async markSkipped(logId: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE wa_automation_logs
       SET status         = 'SKIPPED',
           failure_reason = $1,
           updated_at     = NOW()
       WHERE id = $2`,
      [reason, logId]
    )
  },

  // Called from webhooks.service.ts
  async markDelivered(wamid: string, timestamp: Date): Promise<void> {
    await pool.query(
      `UPDATE wa_automation_logs
       SET status       = 'DELIVERED',
           delivered_at = COALESCE(delivered_at, $1),
           updated_at   = NOW()
       WHERE meta_message_id = $2`,
      [timestamp, wamid]
    )
  },

  async markRead(wamid: string, timestamp: Date): Promise<void> {
    await pool.query(
      `UPDATE wa_automation_logs
       SET status       = 'READ',
           read_at      = COALESCE(read_at, $1),
           delivered_at = COALESCE(delivered_at, $1),
           updated_at   = NOW()
       WHERE meta_message_id = $2`,
      [timestamp, wamid]
    )
  },

  async markFailedByWamid(wamid: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE wa_automation_logs
       SET status         = 'FAILED',
           failure_reason = $1,
           updated_at     = NOW()
       WHERE meta_message_id = $2`,
      [reason, wamid]
    )
  },

  async findByWamid(wamid: string): Promise<{ id: string } | null> {
    const { rows } = await pool.query(
      `SELECT id FROM wa_automation_logs WHERE meta_message_id = $1 LIMIT 1`,
      [wamid]
    )
    return rows[0] ?? null
  },

  // Check if a log already exists for this reference + event (dedup for event-based)
  async logExistsForReference(referenceId: string, eventType: AutomationEventType): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM wa_automation_logs
       WHERE reference_id = $1
         AND event_type   = $2
         AND status NOT IN ('FAILED', 'SKIPPED')
       LIMIT 1`,
      [referenceId, eventType]
    )
    return rows.length > 0
  },

  // Used by the reviews module to detect "was a review_request recently sent
  // to this phone" when a plain-text reply comes in — phone_number here is
  // digits-only via formatPhone(), matching Meta's inbound msg.from as-is.
  async findRecentReviewRequestLog(
    phone: string,
    salonId: string,
    withinHours = 72
  ): Promise<{ reference_id: string | null; meta_message_id: string | null; client_id: string | null } | null> {
    const { rows } = await pool.query(
      `SELECT reference_id, meta_message_id, client_id
       FROM wa_automation_logs
       WHERE phone_number = $1 AND salon_id = $2 AND event_type = 'review_request'
         AND status IN ('SENT', 'DELIVERED', 'READ')
         AND sent_at > NOW() - ($3 || ' hours')::INTERVAL
       ORDER BY sent_at DESC LIMIT 1`,
      [phone, salonId, withinHours]
    )
    return rows[0] ?? null
  },

  async listLogs(filters: ListAutomationLogsFilters): Promise<{ data: AutomationLog[]; total: number }> {
    const page   = Math.max(1, parseInt(String(filters.page  ?? 1))  || 1)
    const limit  = Math.min(100, Math.max(1, parseInt(String(filters.limit ?? 20)) || 20))
    const offset = (page - 1) * limit

    const conditions: string[] = ['salon_id = $1']
    const values: any[]        = [filters.salonId]
    let idx = 2

    if (filters.eventType) { conditions.push(`event_type = $${idx++}`); values.push(filters.eventType) }
    if (filters.status)    { conditions.push(`status = $${idx++}`);      values.push(filters.status) }
    if (filters.clientId)  { conditions.push(`client_id = $${idx++}`);   values.push(filters.clientId) }

    const where = conditions.join(' AND ')

    const countRes = await pool.query(`SELECT COUNT(*) FROM wa_automation_logs WHERE ${where}`, values)
    const dataRes  = await pool.query(
      `SELECT * FROM wa_automation_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    )

    return { data: dataRes.rows, total: parseInt(countRes.rows[0].count) }
  },

  // ── Dedup Guard ───────────────────────────────────────────────────────────

  // Atomic insert-if-not-exists — returns true if this worker won the race
  async guardInsertIfNotExists(key: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `INSERT INTO wa_automation_sent_guard (guard_key)
       VALUES ($1)
       ON CONFLICT (guard_key) DO NOTHING`,
      [key]
    )
    return (rowCount ?? 0) > 0
  },

  // Keep these for backward compat — used in legacy paths
  async guardExists(key: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM wa_automation_sent_guard WHERE guard_key = $1`,
      [key]
    )
    return rows.length > 0
  },

  async guardInsert(key: string): Promise<void> {
    await pool.query(
      `INSERT INTO wa_automation_sent_guard (guard_key) VALUES ($1) ON CONFLICT DO NOTHING`,
      [key]
    )
  },

  // ── Scheduler Queries ─────────────────────────────────────────────────────

  // Appointments in a 2-hour window around exactly 24h from now
  async getAppointmentsForReminder(): Promise<Array<{
    appointment_id:         string
    salon_id:               string
    client_id:              string | null
    phone_number:           string | null
    phone_country_code:     string | null
    client_name:            string | null
    salon_name:             string | null
    scheduled_at:           string
    service_name:           string | null
    whatsapp_notifications: boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         a.id                    AS appointment_id,
         a.salon_id,
         a.client_id,
         c.phone_number,
         c.phone_country_code,
         c.full_name             AS client_name,
         s.business_name AS salon_name,
         a.scheduled_at,
         (a.services->0->>'name') AS service_name,
         c.whatsapp_notifications
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN salons  s ON s.id = a.salon_id
       WHERE a.status IN ('booked','partial')
         AND a.deleted_at IS NULL
         AND a.scheduled_at BETWEEN NOW() + INTERVAL '23 hours 30 minutes'
                                AND NOW() + INTERVAL '24 hours 30 minutes'
         AND c.phone_number           IS NOT NULL
         AND c.whatsapp_notifications = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM wa_automation_logs l
           WHERE l.reference_id = a.id::text
             AND l.event_type   = 'appointment_reminder_24h'
             AND l.status NOT IN ('FAILED','SKIPPED')
         )`
    )
    return rows
  },

  // Appointments in a tight window around exactly 1 hour from now
  async getAppointmentsForReminder1h(): Promise<Array<{
    appointment_id:         string
    salon_id:               string
    client_id:              string | null
    phone_number:           string | null
    phone_country_code:     string | null
    client_name:            string | null
    salon_name:             string | null
    scheduled_at:           string
    service_name:           string | null
    whatsapp_notifications: boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         a.id                    AS appointment_id,
         a.salon_id,
         a.client_id,
         c.phone_number,
         c.phone_country_code,
         c.full_name             AS client_name,
         s.business_name AS salon_name,
         a.scheduled_at,
         (a.services->0->>'name') AS service_name,
         c.whatsapp_notifications
       FROM appointments a
       LEFT JOIN clients c ON c.id = a.client_id
       LEFT JOIN salons  s ON s.id = a.salon_id
       WHERE a.status IN ('booked','partial')
         AND a.deleted_at IS NULL
         AND a.scheduled_at BETWEEN NOW() + INTERVAL '50 minutes'
                                AND NOW() + INTERVAL '70 minutes'
         AND c.phone_number           IS NOT NULL
         AND c.whatsapp_notifications = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM wa_automation_logs l
           WHERE l.reference_id = a.id::text
             AND l.event_type   = 'appointment_reminder_1h'
             AND l.status NOT IN ('FAILED','SKIPPED')
         )`
    )
    return rows
  },

  // Packages expiring in exactly 7 days (IST) — mirrors getMembershipsExpiringIn7Days
  async getPackagesExpiringIn7Days(): Promise<Array<{
    package_id:             string
    client_id:              string
    salon_id:               string
    phone_number:           string | null
    phone_country_code:     string | null
    client_name:            string | null
    package_name:           string
    expiry_date:            string
    whatsapp_notifications: boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         cp.id               AS package_id,
         cp.client_id,
         cp.salon_id,
         cp.mobile           AS phone_number,
         c.phone_country_code,
         cp.client_name,
         cp.package_name,
         cp.expiry_date,
         c.whatsapp_notifications
       FROM client_packages cp
       LEFT JOIN clients c ON c.id = cp.client_id
       WHERE cp.status       = 'Active'
         AND cp.expiry_date IS NOT NULL
         AND (cp.expiry_date)::date
             = ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '7 days')::date
         AND cp.mobile                IS NOT NULL
         AND c.whatsapp_notifications = TRUE`
    )
    return rows
  },

  // Clients with birthday today — IST date comparison
  async getClientsBirthday(): Promise<Array<{
    client_id:              string
    salon_id:               string
    full_name:              string
    phone_number:           string
    phone_country_code:     string | null
    salon_name:             string | null
    whatsapp_marketing:     boolean
  }>> {
    // Convert NOW() to IST (UTC+5:30) for birthday comparison
    const { rows } = await pool.query(
      `SELECT
         c.id                AS client_id,
         c.salon_id,
         c.full_name,
         c.phone_number,
         c.phone_country_code,
         s.business_name AS salon_name,
         c.whatsapp_marketing
       FROM clients c
       JOIN salons s ON s.id = c.salon_id
       WHERE c.birthday_day_month = TO_CHAR(
               (NOW() AT TIME ZONE 'Asia/Kolkata'),
               'MM-DD'
             )
         AND c.phone_number       IS NOT NULL
         AND c.whatsapp_marketing = TRUE
         AND c.is_active          = TRUE`
    )
    return rows
  },

  // Unpaid sales past due date or pending for more than 1 day
  async getOverdueSales(): Promise<Array<{
    sale_id:                string
    salon_id:               string
    client_id:              string | null
    phone_number:           string | null
    phone_country_code:     string | null
    client_name:            string | null
    total_amount:           string
    due_date:               string | null
    whatsapp_notifications: boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         sa.id               AS sale_id,
         sa.salon_id,
         sa.client_id,
         c.phone_number,
         c.phone_country_code,
         c.full_name         AS client_name,
         sa.total_amount,
         sa.due_date,
         c.whatsapp_notifications
       FROM sales sa
       LEFT JOIN clients c ON c.id = sa.client_id
       WHERE sa.status NOT IN ('completed')
         AND c.phone_number       IS NOT NULL
         AND c.whatsapp_notifications = TRUE
         AND (
           (sa.due_date IS NOT NULL AND sa.due_date < NOW())
           OR
           (sa.due_date IS NULL AND sa.created_at < NOW() - INTERVAL '1 day')
         )`
    )
    return rows
  },

  // Memberships expiring in exactly 7 days (IST)
  async getMembershipsExpiringIn7Days(): Promise<Array<{
    membership_id:          string
    client_id:              string
    salon_id:               string
    phone_number:           string | null
    phone_country_code:     string | null
    client_name:            string | null
    membership_name:        string
    expiry_date:            string
    whatsapp_notifications: boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         cm.id               AS membership_id,
         cm.client_id,
         cm.salon_id,
         c.phone_number,
         c.phone_country_code,
         c.full_name         AS client_name,
         m.name              AS membership_name,
         cm.end_date         AS expiry_date,
         c.whatsapp_notifications
       FROM client_memberships cm
       JOIN memberships m ON m.id = cm.membership_id
       JOIN clients     c ON c.id = cm.client_id
       WHERE cm.status      = 'active'
         AND (cm.end_date AT TIME ZONE 'Asia/Kolkata')::date
             = ((NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '7 days')::date
         AND c.phone_number           IS NOT NULL
         AND c.whatsapp_notifications = TRUE`
    )
    return rows
  },

  // Clients inactive for exactly X days (within a 1-day window)
  async getInactiveClients(days: 30 | 60 | 90): Promise<Array<{
    client_id:           string
    salon_id:            string
    full_name:           string
    phone_number:        string
    phone_country_code:  string | null
    salon_name:          string | null
    whatsapp_marketing:  boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         c.id                AS client_id,
         c.salon_id,
         c.full_name,
         c.phone_number,
         c.phone_country_code,
         s.business_name AS salon_name,
         c.whatsapp_marketing
       FROM clients c
       JOIN salons s ON s.id = c.salon_id
       WHERE c.phone_number       IS NOT NULL
         AND c.whatsapp_marketing = TRUE
         AND c.is_active          = TRUE
         AND (
           SELECT MAX(a.scheduled_at)
           FROM appointments a
           WHERE a.client_id = c.id
             AND a.salon_id  = c.salon_id
             AND a.status    = 'paid'
             AND a.deleted_at IS NULL
         ) BETWEEN
           NOW() - ($1 || ' days')::INTERVAL - INTERVAL '1 day'
           AND
           NOW() - ($1 || ' days')::INTERVAL`,
      [days]
    )
    return rows
  },

  // All active salons (for new year campaign)
  async getAllActiveSalonClients(): Promise<Array<{
    client_id:           string
    salon_id:            string
    full_name:           string
    phone_number:        string
    phone_country_code:  string | null
    salon_name:          string | null
    whatsapp_marketing:  boolean
  }>> {
    const { rows } = await pool.query(
      `SELECT
         c.id                AS client_id,
         c.salon_id,
         c.full_name,
         c.phone_number,
         c.phone_country_code,
         s.business_name AS salon_name,
         c.whatsapp_marketing
       FROM clients c
       JOIN salons s ON s.id = c.salon_id
       WHERE c.phone_number       IS NOT NULL
         AND c.whatsapp_marketing = TRUE
         AND c.is_active          = TRUE`
    )
    return rows
  },
}