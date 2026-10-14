-- A campaign contact can now end as SKIPPED: the send worker does not send the same template to the same
-- number twice within 24 hours (campaign.processor.ts). Run this BEFORE deploying that code - the worker
-- writes status = 'SKIPPED', which a CHECK constraint / enum on wa_campaign_contacts.status would reject.
-- Safe to re-run.

DO $$
DECLARE
  col RECORD;
  con RECORD;
BEGIN
  SELECT data_type, udt_name INTO col
    FROM information_schema.columns
   WHERE table_name = 'wa_campaign_contacts' AND column_name = 'status';

  IF col.data_type = 'USER-DEFINED' THEN
    -- status is a Postgres enum
    EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', col.udt_name, 'SKIPPED');
  ELSE
    -- status is text/varchar: replace any CHECK on it with one that includes SKIPPED
    FOR con IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'wa_campaign_contacts'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
      EXECUTE format('ALTER TABLE wa_campaign_contacts DROP CONSTRAINT %I', con.conname);
    END LOOP;

    ALTER TABLE wa_campaign_contacts
      ADD CONSTRAINT wa_campaign_contacts_status_check
      CHECK (status IN ('PENDING','SENT','DELIVERED','READ','FAILED','BLOCKED','SKIPPED'));
  END IF;
END $$;

-- The cooldown looks up "what was sent in the last 24 hours" on every batch.
CREATE INDEX IF NOT EXISTS idx_wa_campaign_contacts_sent_at
  ON wa_campaign_contacts (sent_at) WHERE sent_at IS NOT NULL;
