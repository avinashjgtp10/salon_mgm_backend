-- Lets a salon set how many days after which a service should be redone
-- (e.g. a color touch-up due again in 30 days). NULL = no reminder configured.
-- Not yet consumed by any automation — sits alongside the service record for
-- whenever a reminder job/trigger is built to read it.

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS reminder_after_days INTEGER;
