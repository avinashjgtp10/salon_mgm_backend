exports.shorthands = undefined;

// Adds the two membership mechanics that sit alongside the original wallet type.
//
//   'value'      — wallet (unchanged): pay ₹5,000, get ₹7,000 of spendable balance.
//   'percentage' — discount balance: pay a fee, get N% off every service, where the
//                  DISCOUNT AMOUNT GIVEN depletes `discount_balance` (₹1,000 service
//                  at 20% → ₹200 discount → ₹200 off the balance). This repurposes
//                  the previously inert 'percentage' value, which only ever labelled
//                  how the plan's own selling price was marketed and was read by
//                  nothing in the booking/pricing/payment path.
//   'loyalty'    — free/automatic: after `loyalty_threshold_value` VISITS, the client
//                  unlocks `discount_percent` off, indefinitely. Has no price and no
//                  per-client row — eligibility is evaluated salon-wide against
//                  clients.total_visits. (Originally also supported a day-based
//                  threshold via clients.first_visit_at — dropped before shipping in
//                  favor of visits-only, so that column never made it in here.)
//
// clients.total_visits is introduced here because no canonical visit counter existed
// anywhere in the codebase — visit counts were recomputed on the fly from appointments
// with two mutually inconsistent definitions (paid-only vs paid+partial).
//
// client_memberships gets its denormalized `discount_balance_remaining` via its own
// ensureTable() patch list in client-memberships.repository.ts, not here — that
// table's schema is self-managed at startup.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships
      ADD COLUMN IF NOT EXISTS discount_balance        NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS loyalty_threshold_value INT;

    ALTER TABLE memberships
      ADD CONSTRAINT memberships_loyalty_threshold_value_positive
      CHECK (loyalty_threshold_value IS NULL OR loyalty_threshold_value > 0);

    ALTER TABLE memberships
      ADD CONSTRAINT memberships_discount_balance_non_negative
      CHECK (discount_balance IS NULL OR discount_balance >= 0);

    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS total_visits INT NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE clients
      DROP COLUMN IF EXISTS total_visits;

    ALTER TABLE memberships
      DROP CONSTRAINT IF EXISTS memberships_discount_balance_non_negative,
      DROP CONSTRAINT IF EXISTS memberships_loyalty_threshold_value_positive;

    ALTER TABLE memberships
      DROP COLUMN IF EXISTS loyalty_threshold_value,
      DROP COLUMN IF EXISTS discount_balance;
  `);
};
