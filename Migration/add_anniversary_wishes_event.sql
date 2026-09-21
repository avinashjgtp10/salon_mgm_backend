-- Adds 'anniversary_wishes' as a real, schedulable WhatsApp automation event —
-- companion to the existing 'birthday_wishes' row, both now salon-editable
-- templates ("Upcoming" category in the Trigger Templates UI) instead of
-- birthday's old single global/admin-managed template.
--
-- wa_automation_templates / wa_salon_automation_settings / wa_automation_logs
-- have no CHECK constraint on event_type (plain VARCHAR), so new rows for
-- 'anniversary_wishes' there need no schema change — they seed lazily the
-- same way every other PURCHASE_EVENTS row already does
-- (findOrSeedSalonPurchaseTemplate). Only wa_scheduled_messages enumerates
-- valid event types explicitly, so only its CHECK constraint needs updating.
ALTER TABLE wa_scheduled_messages DROP CONSTRAINT IF EXISTS wa_scheduled_messages_event_type_check;

ALTER TABLE wa_scheduled_messages ADD CONSTRAINT wa_scheduled_messages_event_type_check
  CHECK (event_type IN (
    'package_expiring_7d', 'package_expiring_24h',
    'membership_expiring_7d', 'membership_expiring_24h',
    'package_appointment_reminder_24h', 'service_reminder_24h',
    'birthday_wishes', 'anniversary_wishes', 'new_year_campaign',
    'pending_payment_reminder',
    'we_miss_you_30d', 'we_miss_you_60d', 'we_miss_you_90d'
  ));
