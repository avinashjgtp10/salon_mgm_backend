-- Branch-to-branch stock transfers were previously two independent manual
-- stock_ledger entries (a transfer_out at one branch, a transfer_in at
-- another) with nothing linking them — no guarantee both got created, and no
-- structured way to see "transferred to/from which branch" on either row.
-- These columns turn a transfer into one real, linked operation (written by
-- a single backend transaction — see stock-ledger.repository.ts#createTransfer):
--   - transfer_group_id: shared by both the transfer_out row and its paired
--     transfer_in row, so either one can be used to find the other.
--   - source_branch_id / destination_branch_id: the same pair of values on
--     BOTH rows of a transfer (not just "my own branch_id"), so a single row
--     is self-describing without having to join back to its pair to know
--     where stock came from or went to.
-- All three are NULL for every non-transfer transaction_type.
-- Run by hand against each environment — never auto-run.

ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS transfer_group_id UUID;
ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS source_branch_id UUID;
ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS destination_branch_id UUID;

CREATE INDEX IF NOT EXISTS idx_stock_ledger_transfer_group ON stock_ledger(transfer_group_id);
