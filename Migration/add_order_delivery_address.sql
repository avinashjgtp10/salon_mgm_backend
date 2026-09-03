-- Replaces orders' branch-based Bill To/Ship To fields with a free-text
-- delivery address + instructions — bill_to_branch_id/ship_to_branch_id were
-- purely informational (receive() never routed stock by them — see
-- orders.repository.ts#receive, which always calls purchasesRepository.create
-- with no branch_id at all), so this is a UI/document simplification, not a
-- change to how receiving actually works. The old columns are left in place
-- (still nullable, just no longer written by new orders) rather than dropped,
-- so historical data on existing orders isn't lost.
-- Run by hand against each environment — never auto-run.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT;
