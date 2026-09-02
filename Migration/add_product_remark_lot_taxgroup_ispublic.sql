-- Adds Remark, Lot Number, Tax Group, and Is Public fields to products.
-- Purely additive, safe to re-run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS lot_number VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_group VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
