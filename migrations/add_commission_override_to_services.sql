-- Per-service commission override.
--
-- Lets a service carry its own commission rate, which replaces whatever the
-- staff-level rule would have paid for that service's revenue. Whoever performs
-- the service earns it, and it lands in commission_earned like any other
-- commission, so Staff -> Commissions picks it up with no further changes.
--
-- commission_rate IS NULL  ->  no override; the service falls through to
--                             commission_rules / staff_commission_settings,
--                             i.e. exactly today's behaviour.
--
-- The nullable default is the safety property here: if this migration lags on
-- an environment, services keep earning under the existing staff rules rather
-- than silently paying nothing. Do NOT rewrite this as a NOT NULL flag.
--
-- Note: the pre-existing services.commission_enabled column is unrelated and
-- inert — it is false on every row and no code in the commission engine reads
-- it. It is left untouched here on purpose.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS commission_kind TEXT;

-- percentage -> rate is a % of the service's revenue
-- fixed      -> rate is a flat ₹ amount per service sold
ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_commission_kind_check;

ALTER TABLE services
  ADD CONSTRAINT services_commission_kind_check
  CHECK (commission_kind IS NULL OR commission_kind IN ('percentage', 'fixed'));

-- A rate is meaningless without a kind and vice versa.
ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_commission_override_complete_check;

ALTER TABLE services
  ADD CONSTRAINT services_commission_override_complete_check
  CHECK (
    (commission_rate IS NULL AND commission_kind IS NULL)
    OR (commission_rate IS NOT NULL AND commission_kind IS NOT NULL)
  );
