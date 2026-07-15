exports.shorthands = undefined;

// ex_charges was tracked on appointments but never reached the sales/revenue
// layer at all — payments.service.ts's authoritative recompute silently
// dropped it, so a client-facing surcharge never actually landed in what the
// client owed or in salon revenue. Given its own column (like tip_amount)
// rather than folding into discount_amount as a negative value, since it's a
// distinct, first-class concept: an amount that DOES count as revenue,
// unlike tip_amount which passes through to staff.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS ex_charges NUMERIC(10,2) NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales DROP COLUMN IF EXISTS ex_charges;
  `);
};
