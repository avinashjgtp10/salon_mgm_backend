exports.shorthands = undefined;

// Services paid via an already-purchased Package's included sessions, or via
// a Membership's wallet/discount benefit, were previously forced into the
// nearest existing enum value ('wallet' for package, silently mislabeled
// 'cash' for membership from the frontend) since neither had a real value
// here. Reports read sales.payment_method directly, so that mislabeling
// showed up verbatim as "Wallet" / "Cash" everywhere — Daily Sheet, Sales
// Summary, Invoice Details, Payment History, Client History.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
  `);
  pgm.sql(`
    ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
      CHECK (payment_method IN ('cash','card','gift_card','split','upi','wallet','package','membership'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
  `);
  pgm.sql(`
    ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
      CHECK (payment_method IN ('cash','card','gift_card','split','upi','wallet'));
  `);
};
