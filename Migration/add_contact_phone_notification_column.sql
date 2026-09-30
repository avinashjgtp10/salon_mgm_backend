-- Adds contact_phone to notifications so a WhatsApp-inbound notification can
-- deep-link straight into that client's Inbox conversation, the same
-- click-through purpose product_id/spotlight_feature_id already serve for
-- other notification types. Plain TEXT, not FK'd to anything — a WhatsApp
-- phone number isn't a row in any table, just the raw contact identifier
-- inbox_conversations/inbox_messages already key conversations by.
-- Run by hand against each environment — never auto-run.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_contact_phone
  ON notifications(contact_phone) WHERE contact_phone IS NOT NULL;
