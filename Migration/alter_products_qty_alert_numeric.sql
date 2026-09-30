-- products.qty_alert widened from INTEGER to NUMERIC so a low-stock alert
-- can be entered in the product's own base unit (e.g. ml) and stored as a
-- fractional bottle count (e.g. 200ml / 1000ml bottle_size = 0.2) instead of
-- being forced to round to a whole bottle. qty_alert's meaning is unchanged
-- everywhere else — still always a bottle/package count, still compared via
-- CEIL(amount/bottle_size) <= qty_alert in every low-stock query across the
-- codebase; this just lets that count be a decimal.
-- Run by hand against each environment — never auto-run.

ALTER TABLE products ALTER COLUMN qty_alert TYPE NUMERIC;
