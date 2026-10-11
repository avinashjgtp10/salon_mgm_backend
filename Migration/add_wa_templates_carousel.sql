-- Marketing > Templates: carousel templates (2-10 swipeable cards, each with an
-- image, short text and up to 2 buttons). The cards live here as JSON:
--   [{ "body": "...", "header_media_id": "<Meta media id>",
--      "buttons": [{ "type": "url|quick_reply|phone", "text": "...", "value": "..." }] }]
-- Run on dev, QA and prod BEFORE deploying the backend that creates carousel
-- templates (ordinary templates work without it). Safe to re-run.

ALTER TABLE wa_templates
  ADD COLUMN IF NOT EXISTS carousel JSONB;
