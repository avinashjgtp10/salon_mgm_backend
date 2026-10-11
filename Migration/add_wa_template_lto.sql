-- Marketing > Templates: limited-time-offer badge text (e.g. "Expiring offer!",
-- max 16 chars per Meta). A template with this set is sent with an expiry
-- countdown; the expiry itself is chosen per campaign/send, not stored here.
-- Run on dev, QA and prod BEFORE deploying the backend that creates LTO
-- templates (ordinary templates work without it). Safe to re-run.

ALTER TABLE wa_templates
  ADD COLUMN IF NOT EXISTS lto_text VARCHAR(16);
