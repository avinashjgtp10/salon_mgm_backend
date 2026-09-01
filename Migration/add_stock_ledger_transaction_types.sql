-- Adds Sample, Lost/Missing, and Internal Use to stock_ledger's
-- transaction_type vocabulary (see create_stock_ledger_table.sql for the
-- original CHECK). All three are stock-out types, same bucket as
-- usage/damage/expired — see STOCK_LEDGER_IN_TYPES in stock-ledger.types.ts.
-- Run by hand against each environment — never auto-run.

ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_transaction_type_check;

ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'opening_stock', 'purchase', 'usage', 'sale', 'return',
    'damage', 'expired', 'adjustment_in', 'adjustment_out',
    'transfer_in', 'transfer_out', 'sample', 'lost', 'internal_use'
  ));
