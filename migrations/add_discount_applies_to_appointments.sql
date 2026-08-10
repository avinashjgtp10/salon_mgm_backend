-- Bill Discount "Apply to" selection — which item buckets the bill-level
-- discount field (appointments.discount_value/discount_type) reduces.
-- Stored as a JSONB array of bucket names, e.g. ["service","packages","product","membership"],
-- or the single exclusive value ["bill"] meaning the whole bill total.
--
-- Deliberately nullable with NO backfill: NULL means "legacy scope", which the
-- pricing engine reads as service+packages+membership with an UNCAPPED flat
-- amount — byte-for-byte the behavior every bill written before this column
-- existed was actually charged under. Backfilling old rows to an explicit
-- array (all four buckets especially) would silently re-price every historical
-- receipt and report the next time they were recomputed. New bills always
-- write an explicit array, so the legacy path only ever applies to rows that
-- genuinely predate the feature.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS discount_applies_to JSONB;
