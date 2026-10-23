-- AI Assistant (manager-facing): usage tracking for rate limits / monthly cap,
-- plus the permission key that gates it.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) BEFORE deploying the backend that
-- serves /api/v1/ai-assistant. (Without ai_usage the endpoint still answers,
-- but rate limits and the monthly cap are skipped and logged as a warning.)

BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id   UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    kind       VARCHAR(20) NOT NULL,          -- 'chat' | 'image'
    model      VARCHAR(100) NOT NULL,
    tokens     INT         NOT NULL DEFAULT 0, -- image calls log 0 tokens, 1 row per image
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time  ON ai_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_salon_time ON ai_usage (salon_id, created_at DESC);

-- Poster maker history (one row per generated poster + its channel copy).
CREATE TABLE IF NOT EXISTS ai_generated_assets (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id   UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    brief      TEXT        NOT NULL,
    format     VARCHAR(10) NOT NULL,           -- 'post' | 'story'
    image_url  TEXT        NOT NULL,
    copy       JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_generated_assets_salon_time ON ai_generated_assets (salon_id, created_at DESC);

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('use_ai_assistant', 'AI Assistant — Use', 'Ask the AI Assistant questions about SalonOx and this salon''s data', 'AI Assistant', 'General', 'view', 'low', ARRAY[]::text[])
ON CONFLICT (key) DO NOTHING;

COMMIT;
