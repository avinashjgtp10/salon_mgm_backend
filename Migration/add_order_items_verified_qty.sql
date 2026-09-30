-- Separates "verified" (what the Verify Order tab records as arrived/
-- damaged, informational only) from "received" (order_items.received_qty/
-- damaged_qty — actual stock-in, ONLY ever written by orders.repository.ts's
-- receive(), called from Product Inventory -> Record Purchase -> pick this
-- supplier's open order). These must be separate columns: if Verify Order
-- wrote to received_qty/damaged_qty directly, Product Inventory's "how much
-- is still outstanding on this PO" calculation (qty - received_qty -
-- damaged_qty) would immediately read 0 remaining the moment something was
-- verified, blocking the ONE flow that's actually supposed to add stock —
-- even though no stock had been added yet.
-- Run by hand against each environment — never auto-run.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS verified_qty NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS verified_damaged_qty NUMERIC NOT NULL DEFAULT 0;
