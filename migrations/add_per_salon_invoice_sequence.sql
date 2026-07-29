-- Per-salon sequential invoice numbering (1, 2, 3, ...) instead of the prior
-- timestamp+random invoice_number scheme.

-- Counter column: next_invoice_seq starts at 1 for every existing and new salon.
ALTER TABLE salons ADD COLUMN IF NOT EXISTS next_invoice_seq INTEGER NOT NULL DEFAULT 1;

-- The old sales_invoice_number_key was a bare UNIQUE(invoice_number), which would
-- collide across salons once invoice numbers become per-salon sequences (e.g. two
-- salons both issuing INV-00001). Widen it to be scoped per salon.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_invoice_number_key;
ALTER TABLE sales ADD CONSTRAINT sales_invoice_number_salon_key UNIQUE (salon_id, invoice_number);
