-- Service Chain: drafts, smart skip rules, repeat-purchase policy and per-client pause.
--
--   service_chains.is_draft            a half-filled chain saved for later; never enrols or sends (is_active stays FALSE
--                                      until it is activated, which runs the full validation)
--   service_chains.on_repeat           what a repeat purchase of the starting service does while a journey is running:
--                                      'restart' (cancel the unsent steps, start again from the new purchase) or
--                                      'ignore_until_finished' (the new purchase starts nothing)
--   service_chains.skip_if_bought      skip a step if the client already bought its service since joining   (default on)
--   service_chains.skip_if_completed   skip a step if the client already had that service done               (default on)
--   service_chains.skip_if_upcoming    skip a step if the client already has an upcoming appointment for it (default on)
--   service_chain_steps.skip_if_bought_days
--                                      skip a step if the client bought its service in the last N days, counting
--                                      purchases made BEFORE joining the chain too (NULL = off)
--   service_chain_enrolments.status    gains 'paused' (a salon paused this one client's journey)
--
-- Requires create_service_chains.sql and add_service_chain_substeps.sql to have been applied first.
-- Per project policy this file is NOT auto-run; apply it by hand BEFORE the backend deploy.

BEGIN;

ALTER TABLE service_chains
  ADD COLUMN IF NOT EXISTS is_draft          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS on_repeat         TEXT    NOT NULL DEFAULT 'restart',
  ADD COLUMN IF NOT EXISTS skip_if_bought    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS skip_if_completed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS skip_if_upcoming  BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE service_chains DROP CONSTRAINT IF EXISTS service_chains_on_repeat_check;
ALTER TABLE service_chains
  ADD CONSTRAINT service_chains_on_repeat_check CHECK (on_repeat IN ('restart', 'ignore_until_finished'));

ALTER TABLE service_chain_steps
  ADD COLUMN IF NOT EXISTS skip_if_bought_days INT;
ALTER TABLE service_chain_steps DROP CONSTRAINT IF EXISTS service_chain_steps_skip_days_check;
ALTER TABLE service_chain_steps
  ADD CONSTRAINT service_chain_steps_skip_days_check CHECK (skip_if_bought_days IS NULL OR skip_if_bought_days BETWEEN 1 AND 730);

ALTER TABLE service_chain_enrolments DROP CONSTRAINT IF EXISTS service_chain_enrolments_status_check;
ALTER TABLE service_chain_enrolments
  ADD CONSTRAINT service_chain_enrolments_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'replaced', 'superseded'));

-- One live journey per client per chain: a paused journey still counts as live.
DROP INDEX IF EXISTS uq_service_chain_enrol_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_chain_enrol_active
  ON service_chain_enrolments (chain_id, client_id) WHERE status IN ('active', 'paused');

COMMIT;
