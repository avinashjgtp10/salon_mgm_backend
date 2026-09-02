-- Adds an optional supplier_id to stock_ledger so a manual "Add Stock" entry
-- can be attributed to a real supplier when it actually came from one (e.g.
-- reason "Purchase Stock" against a delivery the Orders/Purchases flow
-- wasn't used for). NULL for entries with no supplier — Client Return,
-- Branch Transfer, Opening Stock, adjustments, sales, expiry write-offs, etc.
-- This does NOT feed Purchase History or supplier balances (those stay
-- sourced from purchases/purchase_items only) — it's purely a display/
-- attribution field on the Stock Ledger itself.
-- Run by hand against each environment — never auto-run.

ALTER TABLE stock_ledger ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_supplier ON stock_ledger(supplier_id);
