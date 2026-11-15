-- Cash Counter: edit an opened / closed counter.
--  1. cash_management_edits: one row per saved edit (who, when, old and new values) so the counter's history is kept.
--  2. edit_counter permission (Cash Management group). NOT granted to anyone here: tick it per role in
--     Settings > Roles & Permissions.
-- The two new WhatsApp events (cash_counter_opened_updated / cash_counter_closed_updated) need no SQL, but like every
-- other event their template must be submitted to and approved by Meta before the message actually sends.
--
-- Per project policy this file is NOT auto-run; apply by hand (dev -> QA -> prod), and BEFORE the backend deploy
-- (the edit endpoint writes to cash_management_edits).

BEGIN;

CREATE TABLE IF NOT EXISTS cash_management_edits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_management_id UUID NOT NULL REFERENCES cash_management(id) ON DELETE CASCADE,
  salon_id           UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  edited_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  edited_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_values         JSONB NOT NULL,
  new_values         JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS cash_management_edits_counter_idx
  ON cash_management_edits (cash_management_id, edited_at DESC);

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('edit_counter', 'Edit Counter', 'Edit the details of an opened or closed cash counter', 'Cash Management', 'Cash Management', 'edit', 'high', ARRAY['view_cash_management'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
