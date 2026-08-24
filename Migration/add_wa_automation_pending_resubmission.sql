-- Lets a salon owner edit + resubmit a trigger template's wording for Meta
-- approval WITHOUT interrupting the currently-APPROVED template's live
-- sending. Previously, resubmitting immediately overwrote the row's own
-- status/template_name/body_text — the moment you hit Submit, the live
-- template flipped to PENDING and trigger() (which only ever sends from an
-- APPROVED row) stopped finding one, so the event silently stopped sending
-- until Meta approved the new version (minutes to hours later).
--
-- These columns hold the in-flight resubmission candidate alongside the
-- still-live approved one. wa-purchase-templates.service.ts writes edits/
-- submissions here whenever a live APPROVED template already exists, and
-- only copies pending_* into the live columns (the "swap") once Meta
-- actually approves the new template — see syncStatus()'s promotion step.
ALTER TABLE wa_automation_templates
  ADD COLUMN IF NOT EXISTS pending_body_text        TEXT,
  ADD COLUMN IF NOT EXISTS pending_status            VARCHAR(10),   -- NULL | 'PENDING' | 'REJECTED'
  ADD COLUMN IF NOT EXISTS pending_template_name     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pending_meta_template_id  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS pending_rejection_reason  TEXT;
