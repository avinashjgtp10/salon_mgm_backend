-- One login per client type (web / mobile) instead of one per account.
-- Existing sessions are classed as 'web'; a mobile user simply gets the
-- correct type on their next login.
-- MUST run BEFORE the backend deploy: saveRefreshToken now inserts client_type.

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'web';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_client_type_check'
  ) THEN
    ALTER TABLE refresh_tokens
      ADD CONSTRAINT refresh_tokens_client_type_check
      CHECK (client_type IN ('web', 'mobile'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_client_type
  ON refresh_tokens (user_id, client_type);
