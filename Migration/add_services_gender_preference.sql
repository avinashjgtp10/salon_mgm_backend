-- Service gender preference.
--
-- A service can now say who it is for: 'unisex' (anyone, the default), 'female' or 'male'. It is picked on the
-- Add / Edit Service form. gender_preference used to be sent by the form but had no column, so the API dropped
-- it silently; this gives it one.
--
-- NOT NULL DEFAULT 'unisex' backfills every existing service as "anyone", which is exactly how they behave today,
-- so there is nothing else to backfill. The CHECK keeps the value to the three the form offers.
--
-- Safe to run more than once. RUN THIS BEFORE deploying the backend change: creating a service writes this column
-- and will fail with "column gender_preference does not exist" until it exists. Per project policy this file is
-- created but NOT auto-run; apply it by hand against each environment (dev/QA/prod) in that order.

BEGIN;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS gender_preference VARCHAR(10) NOT NULL DEFAULT 'unisex';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'services_gender_preference_check'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_gender_preference_check
      CHECK (gender_preference IN ('unisex', 'female', 'male'));
  END IF;
END $$;

COMMIT;
