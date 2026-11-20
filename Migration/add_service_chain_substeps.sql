-- Service Chain: sub-steps.
--
-- Each step of a chain can have sub-steps (e.g. aftercare: "keep your hair clean, don't use hot water"):
--
--   Step 1 (the starting service)  -> sub-steps, timed from the first payment
--   Step 2                         -> sub-steps, timed from step 2's send time
--   Step 3                         -> sub-steps, timed from step 3's send time
--
-- A sub-step is stored as a row of service_chain_steps:
--   is_sub = TRUE, delay_minutes = wait after its parent (10 minutes .. 30 days), service_id NULL,
--   parent_step_id = its step, or NULL for the starting service's own sub-steps.
-- Normal steps keep is_sub = FALSE and delay_minutes NULL, so existing chains are untouched.
-- A sub-step is only sent if its parent step was actually sent.
--
-- Requires create_service_chains.sql to have been applied first.
-- Per project policy this file is NOT auto-run; apply it by hand BEFORE the backend deploy.

BEGIN;

ALTER TABLE service_chain_steps
  ADD COLUMN IF NOT EXISTS parent_step_id UUID REFERENCES service_chain_steps(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_sub         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delay_minutes  INT;

ALTER TABLE service_chain_steps DROP CONSTRAINT IF EXISTS service_chain_steps_delay_minutes_check;
ALTER TABLE service_chain_steps
  ADD CONSTRAINT service_chain_steps_delay_minutes_check
  CHECK ((is_sub = FALSE AND delay_minutes IS NULL) OR (is_sub = TRUE AND delay_minutes BETWEEN 10 AND 43200));

CREATE INDEX IF NOT EXISTS idx_service_chain_steps_parent ON service_chain_steps (parent_step_id) WHERE parent_step_id IS NOT NULL;

COMMIT;
