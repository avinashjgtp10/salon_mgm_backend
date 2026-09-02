-- Adds Audit Adjustment (in/out) to stock_ledger's transaction_type
-- vocabulary — written when a Product Audit is approved and its physical
-- count differs from system stock. Kept as its own distinct type rather
-- than reusing adjustment_in/adjustment_out so these rows are identifiable
-- as audit-driven corrections, not ad-hoc manual entries.
-- See product-audit.repository.ts#approveWithAdjustments.
-- Run by hand against each environment — never auto-run.

ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_transaction_type_check;

ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'opening_stock', 'purchase', 'usage', 'sale', 'return',
    'damage', 'expired', 'adjustment_in', 'adjustment_out',
    'transfer_in', 'transfer_out', 'sample', 'lost', 'internal_use',
    'audit_adjustment_in', 'audit_adjustment_out'
  ));
