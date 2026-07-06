-- Lets each salon own and submit its own copy of a purchase-event WhatsApp
-- template to Meta under its own WABA, instead of one global admin-managed
-- template shared by every salon. Legacy rows (salon_id IS NULL) are
-- untouched and keep working exactly as before.

-- wa_automation_templates currently has a UNIQUE constraint on event_type
-- alone (one global row per event) — this must go before per-salon rows can
-- share the same event_type.
ALTER TABLE wa_automation_templates
  DROP CONSTRAINT IF EXISTS wa_automation_templates_event_type_key;
DROP INDEX IF EXISTS wa_automation_templates_event_type_key;

ALTER TABLE wa_automation_templates
  ADD COLUMN IF NOT EXISTS salon_id UUID,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'UTILITY',
  ADD COLUMN IF NOT EXISTS body_text TEXT,
  ADD COLUMN IF NOT EXISTS meta_template_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- One row per (salon_id, event_type) for the new per-salon purchase templates.
CREATE UNIQUE INDEX IF NOT EXISTS wa_automation_templates_salon_event_uq
  ON wa_automation_templates (salon_id, event_type)
  WHERE salon_id IS NOT NULL;

-- Preserves the original one-row-per-event_type rule for legacy global rows.
CREATE UNIQUE INDEX IF NOT EXISTS wa_automation_templates_global_event_uq
  ON wa_automation_templates (event_type)
  WHERE salon_id IS NULL;

-- Existing global rows are already-active legacy templates, not part of the
-- new draft/approval workflow.
UPDATE wa_automation_templates SET status = 'APPROVED' WHERE salon_id IS NULL;
