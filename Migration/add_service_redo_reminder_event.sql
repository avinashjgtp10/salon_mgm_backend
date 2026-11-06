-- Service "time to redo" reminder (services.reminder_after_days).
--
-- That column used to be saved and never read, so no reminder was ever sent. The hourly
-- automation sweep now schedules a 'service_redo_reminder' row in wa_scheduled_messages N days
-- after a paid visit (see waScheduledMessagesService.seedServiceRedoReminders), so the table's
-- event_type CHECK has to allow the new value.
--
-- Run this BEFORE deploying the backend: without it the sweep's INSERT is rejected by the CHECK
-- (it logs the error and carries on, nothing else breaks).
--
-- Idempotent: safe to run more than once.

ALTER TABLE wa_scheduled_messages
  DROP CONSTRAINT IF EXISTS wa_scheduled_messages_event_type_check;

ALTER TABLE wa_scheduled_messages
  ADD CONSTRAINT wa_scheduled_messages_event_type_check CHECK (event_type::text = ANY (ARRAY[
    'package_expiring_7d', 'package_expiring_24h',
    'membership_expiring_7d', 'membership_expiring_24h',
    'package_appointment_reminder_24h', 'service_reminder_24h',
    'birthday_wishes', 'anniversary_wishes', 'new_year_campaign',
    'pending_payment_reminder',
    'we_miss_you_30d', 'we_miss_you_60d', 'we_miss_you_90d',
    'service_redo_reminder'
  ]::text[]));
