-- Scheduled Templates feature — individually-addressable rows for the 12
-- "schedulable" WhatsApp automation events:
--   Group A (real commitment, created at source-entity-creation time):
--     package_expiring_7d, package_expiring_24h,
--     membership_expiring_7d, membership_expiring_24h,
--     package_appointment_reminder_24h, service_reminder_24h,
--     birthday_wishes, new_year_campaign
--   Group B (1-day rolling preview, recomputed nightly):
--     pending_payment_reminder, we_miss_you_30d, we_miss_you_60d, we_miss_you_90d
-- Every other AutomationEventType (bill_receipt, confirmations, purchases,
-- session-used, rewards, ewallet/referral/points-used, etc.) fires
-- synchronously off a real-time user action and never gets a row here.

CREATE TABLE IF NOT EXISTS wa_scheduled_messages (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id            UUID          NOT NULL,
  client_id           UUID          NULL,
  phone_number        VARCHAR(20)   NOT NULL,
  phone_country_code  VARCHAR(8)    NULL,

  event_type          VARCHAR(50)   NOT NULL CHECK (event_type IN (
                          'package_expiring_7d', 'package_expiring_24h',
                          'membership_expiring_7d', 'membership_expiring_24h',
                          'package_appointment_reminder_24h', 'service_reminder_24h',
                          'birthday_wishes', 'new_year_campaign',
                          'pending_payment_reminder',
                          'we_miss_you_30d', 'we_miss_you_60d', 'we_miss_you_90d'
                        )),
  -- FALSE = Group A (a real commitment scheduled at source-entity-creation
  -- time, tied 1:1 to a concrete future send). TRUE = Group B (a rolling
  -- next-24h candidate, recomputed nightly — may be replaced/deleted before
  -- it's ever due since the underlying condition can change day to day).
  is_preview          BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Ties back to the source row this was scheduled from (client_packages.id,
  -- client_memberships.id, appointments.id, clients.id) — same
  -- reference_id/reference_type convention as wa_automation_logs. Used to
  -- find-and-update-in-lockstep when the source entity is
  -- rescheduled/cancelled.
  reference_id        UUID          NULL,
  reference_type      VARCHAR(30)   NULL,

  scheduled_at        TIMESTAMPTZ   NOT NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'SCHEDULED'
                        CHECK (status IN ('SCHEDULED','SENDING','SENT','FAILED','SKIPPED','CANCELLED')),

  -- Rendered at row-creation/recompute time — wa_automation_logs never
  -- persists variables, so this table stores its own so the Message column
  -- and "View Details"/"View Failure Reason" can render without
  -- re-deriving anything later, even long after the source entity changed.
  variables            JSONB        NOT NULL DEFAULT '{}',
  message_preview       TEXT        NULL,

  failure_reason        TEXT        NULL,
  attempt_count          INT        NOT NULL DEFAULT 0,
  sent_at              TIMESTAMPTZ  NULL,
  cancelled_at         TIMESTAMPTZ  NULL,

  -- Set once the executor's trigger() call produces a log row — lets "View
  -- Delivery Status" on a Sent row jump straight to wa_automation_logs'
  -- delivered_at/read_at instead of duplicating that tracking here.
  automation_log_id    UUID         NULL REFERENCES wa_automation_logs(id),

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Poller's hot query: due rows ready to send.
CREATE INDEX IF NOT EXISTS idx_wa_sched_due
  ON wa_scheduled_messages (status, scheduled_at)
  WHERE status = 'SCHEDULED';

-- List page: per-salon, filtered/paginated, newest-scheduled first.
CREATE INDEX IF NOT EXISTS idx_wa_sched_salon_list
  ON wa_scheduled_messages (salon_id, scheduled_at DESC);

-- Reschedule/cancel-in-lockstep lookups (find the row(s) tied to a package/
-- membership/appointment/client when its source entity changes).
CREATE INDEX IF NOT EXISTS idx_wa_sched_reference
  ON wa_scheduled_messages (reference_type, reference_id, event_type)
  WHERE status = 'SCHEDULED';

-- Guarantees one live SCHEDULED row per (source entity, event type) — a
-- second upsert for the same reference simply moves scheduled_at instead of
-- creating a duplicate, which is what makes "reschedule" and "create if
-- missing" the same code path everywhere this table is written to. Partial
-- (WHERE status='SCHEDULED') so it only guards the live state, not history —
-- a SENT/CANCELLED row never blocks a fresh SCHEDULED one for the same
-- reference+event (e.g. a renewed membership's new expiry reminder).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_sched_live_reference
  ON wa_scheduled_messages (reference_type, reference_id, event_type)
  WHERE status = 'SCHEDULED';
