-- Salon soft delete ("archive"). Super Admin -> Real Salons -> Delete never permanently deletes a salon that has transaction history
-- (sales, payments, invoices, appointments, purchases, payroll, paid subscriptions...): it archives it instead — deactivated, its owner and
-- staff logins switched off, hidden from the normal Salons lists, all records kept. Only a salon with no such history is purged.
-- The backend adds these columns itself on first use; this file is the same change for environments that prefer to apply it by hand.
-- Per project policy it is not auto-run. Safe to re-run.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by       UUID,
  ADD COLUMN IF NOT EXISTS deletion_reason  TEXT,
  ADD COLUMN IF NOT EXISTS deleted_user_ids UUID[];   -- logins switched off by the archive; a restore switches back on exactly these

CREATE INDEX IF NOT EXISTS idx_salons_deleted_at ON salons (deleted_at) WHERE deleted_at IS NOT NULL;
