-- Migration: unify appointment status
-- Collapses appointments.status + payment state (derived from the `payments`
-- table, NOT a payment_status column — confirmed via live-DB inspection that
-- no such column exists on `appointments`; the migration that was supposed to
-- add it was apparently never run) + deleted_at into a single `status` column:
-- booked | paid | partial | cancelled | no-show | deleted.
--
-- NOT run automatically. Verified against the live dev DB (salonoxdb_dev,
-- Postgres 17.9) before writing this:
--   - `status` is a native Postgres ENUM type (`appointment_status`), not a
--     VARCHAR + CHECK constraint — there is no `appointments_status_check`.
--   - Current enum values: booked, confirmed, in_progress, completed,
--     cancelled, no_show.
--   - `payment_status` column: confirmed absent.
--   - Backfill was dry-run simulated against live data (924 rows):
--     booked=179, paid=661, partial=59, cancelled=19, deleted=6 — totals
--     reconcile exactly against the current status counts (no data loss).
--
-- Decision: add the 4 new enum values and leave the old, now-unused labels
-- (confirmed/in_progress/completed/no_show) defined on the type rather than
-- doing a full enum-type recreation — Postgres has no ALTER TYPE ... DROP
-- VALUE, so removing them cleanly would require creating a new type, casting
-- the column over via USING, and dropping the old type. Lower risk to just
-- stop using the old labels (enforced at the application layer going
-- forward) than to do that swap for a handful of harmless unused labels.

-- 1. Add the new enum values (each ADD VALUE auto-commits as its own
--    statement under psql's default autocommit, so it's visible to the
--    UPDATE below regardless of Postgres version quirks around using a new
--    enum value inside the same transaction it was added in).
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'partial';
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'no-show';
ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'deleted';

-- 2. Backfill: translate every existing row into the new unified status.
--    Payment state (paid/partial) is derived from the real `payments` table —
--    same logic appointments.repository.ts used to compute payment_status
--    live before this migration — since there was never a reliable
--    payment_status column to read from.
UPDATE appointments a SET status = (CASE
  WHEN a.deleted_at IS NOT NULL THEN 'deleted'
  WHEN a.status = 'cancelled' THEN 'cancelled'
  WHEN a.status = 'no_show' THEN 'no-show'
  WHEN a.status = 'completed' THEN 'paid'
  WHEN EXISTS (
    SELECT 1 FROM payments p WHERE p.appointment_id = a.id
      AND p.status IN ('completed', 'partial')
      AND COALESCE(p.due_amount, 0) = 0
  ) THEN 'paid'
  WHEN EXISTS (
    SELECT 1 FROM payments p WHERE p.appointment_id = a.id
      AND p.status IN ('completed', 'partial')
  ) THEN 'partial'
  ELSE 'booked'
END)::appointment_status;

-- 3. Drop now-redundant columns. payment_status is IF EXISTS defensively in
--    case some other environment (staging/prod) actually has it, unlike dev.
ALTER TABLE appointments DROP COLUMN IF EXISTS payment_status;
ALTER TABLE appointments DROP COLUMN IF EXISTS service_started_at;
ALTER TABLE appointments DROP COLUMN IF EXISTS service_ended_at;
