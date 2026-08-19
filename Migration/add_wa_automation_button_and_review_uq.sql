-- Restores what migrations/add_wa_review_button_support.sql did before the
-- whole migrations/ and db-migrations/ folders were wiped in SCRUM-1421
-- ("Remove Old Migrations and Create a New Migration Structure") — the new
-- structure never actually replaced this file, so wa_automation_templates
-- was left missing these columns while the app code still reads/writes them
-- (wa-purchase-templates.service.ts, whatsapp-automation.repository.ts).
--
-- Adds generic CTA-URL-button support to wa_automation_templates so any
-- purchase/lifecycle event (not just review_request) can carry one Meta URL
-- button with a dynamic {{1}} suffix, filled in per-recipient at send time.
ALTER TABLE wa_automation_templates
  ADD COLUMN IF NOT EXISTS has_button      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS button_text     VARCHAR(25),   -- Meta caps button text at 25 chars
  ADD COLUMN IF NOT EXISTS button_url_base TEXT;

-- Lets the public feedback-submission endpoint upsert by appointment
-- (booking_id) instead of inserting duplicate rows when a client re-opens
-- or double-taps the feedback link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_booking_id_uq
  ON reviews (booking_id) WHERE booking_id IS NOT NULL;
