-- Replaces the per-salon/per-financial-year counter table (which got stuck
-- returning the same seq on repeated collisions) with a single global
-- Postgres SEQUENCE — nextval() is atomic and monotonically increasing by
-- definition, so every call is guaranteed a brand new number with no
-- possibility of ever repeating, regardless of concurrent requests or any
-- retry logic. Safe to re-run.

CREATE SEQUENCE IF NOT EXISTS salon_plan_invoice_no_seq START 1;
