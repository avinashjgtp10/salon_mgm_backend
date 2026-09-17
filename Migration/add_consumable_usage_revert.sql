-- Revert a consumable deduction from Consumable History.
--
-- Stock is NOT derived from consumable_usage — products.amount is the
-- authoritative figure and this table is the audit log beside it — so a revert
-- is two writes (restore the stock, append a 'return' row), and these columns
-- are what tie the two together and stop the same deduction being reverted
-- twice.
--
-- Nothing here is destructive and every statement is idempotent; safe to
-- re-run.

-- When the original deduction was reverted, and by whom. NULL = not reverted.
-- Kept on the ORIGINAL row (not just inferred from the revert row) so the
-- history list can render per-row state without a self-join.
ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS reverted_at TIMESTAMPTZ;
ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS reverted_by UUID;

-- Set on the NEW 'return' row, pointing at the deduction it reverses. This is
-- what makes the pair auditable: the original consumption row is never
-- deleted or mutated beyond the two stamps above.
ALTER TABLE consumable_usage ADD COLUMN IF NOT EXISTS reverts_usage_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'consumable_usage_reverted_by_fkey'
  ) THEN
    ALTER TABLE consumable_usage
      ADD CONSTRAINT consumable_usage_reverted_by_fkey
      FOREIGN KEY (reverted_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'consumable_usage_reverts_usage_id_fkey'
  ) THEN
    ALTER TABLE consumable_usage
      ADD CONSTRAINT consumable_usage_reverts_usage_id_fkey
      FOREIGN KEY (reverts_usage_id) REFERENCES consumable_usage(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- THE actual guard against double-reverting, and the reason this is an index
-- rather than a check in application code: two concurrent revert requests for
-- the same deduction (a double-clicked button) both pass an
-- "is it already reverted?" read before either writes. A unique index makes
-- the second INSERT fail at the database, inside the same transaction that
-- moves the stock — so the losing request restores nothing.
CREATE UNIQUE INDEX IF NOT EXISTS consumable_usage_one_revert_per_row
  ON consumable_usage (reverts_usage_id)
  WHERE reverts_usage_id IS NOT NULL;

-- The history list filters to a product and orders by date; these columns are
-- read on every row to decide whether to show the Revert button.
CREATE INDEX IF NOT EXISTS consumable_usage_reverted_at_idx
  ON consumable_usage (reverted_at)
  WHERE reverted_at IS NOT NULL;
