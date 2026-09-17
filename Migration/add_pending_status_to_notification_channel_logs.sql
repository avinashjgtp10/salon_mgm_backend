-- Email/SMS delivery logs previously recorded only the outcome (SENT / FAILED
-- / SKIPPED), written after the provider call resolved. That leaves a send that
-- crashed or hung mid-flight with no row at all — indistinguishable from one
-- that was never attempted.
--
-- PENDING is written before the provider is called and updated in place when it
-- resolves, so an in-flight or abandoned send is visible rather than missing.
--
-- The application tolerates this migration not having been run: it tries the
-- PENDING insert first and falls back to logging only the final outcome when
-- the CHECK constraint rejects it (Postgres 23514), so nothing breaks either
-- way — you just don't get the in-flight row until this runs.
ALTER TABLE notification_channel_logs
  DROP CONSTRAINT IF EXISTS notification_channel_logs_status_check;

ALTER TABLE notification_channel_logs
  ADD CONSTRAINT notification_channel_logs_status_check
  CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED'));
