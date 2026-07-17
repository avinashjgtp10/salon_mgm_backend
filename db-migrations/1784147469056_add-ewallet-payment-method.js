exports.shorthands = undefined;

// Manual eWallet top-ups are real money collected at the front desk (cash/
// card/upi) — staff need to know which one for end-of-day cash-drawer
// reconciliation, same reason packages/memberships already capture it.
// Only meaningful for type='topup' rows; redeem/adjust rows leave it null.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE ewallet_ledger
      ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE ewallet_ledger DROP COLUMN IF EXISTS payment_method;
  `);
};
