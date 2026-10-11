-- Expiry date captured per Purchase Order line (Create Order), so it is saved
-- on the order and reused when the line is received instead of being re-typed.
-- Nullable: not every product expires, and existing order lines have none.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS expiry_date DATE;
