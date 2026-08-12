-- Adds generic CTA-URL-button support to wa_automation_templates so any
-- purchase/lifecycle event (not just review_request) can carry one Meta
-- URL button with a dynamic {{1}} suffix, filled in per-recipient at send
-- time. Kept generic/reusable rather than review_request-specific, matching
-- how PURCHASE_EVENTS already share one schema for all salon-editable
-- templates (see add_salon_scope_to_wa_automation_templates.sql).
ALTER TABLE wa_automation_templates
  ADD COLUMN IF NOT EXISTS has_button      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS button_text     VARCHAR(25),   -- Meta caps button text at 25 chars
  ADD COLUMN IF NOT EXISTS button_url_base TEXT;

-- Lets the new public feedback-submission endpoint upsert by appointment
-- (booking_id) instead of inserting duplicate rows when a client re-opens
-- or double-taps the feedback link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_booking_id_uq
  ON reviews (booking_id) WHERE booking_id IS NOT NULL;
