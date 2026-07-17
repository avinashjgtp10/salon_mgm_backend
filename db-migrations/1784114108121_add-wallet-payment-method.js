exports.shorthands = undefined;

// eWallet-only payments get their own value instead of being folded into
// 'split' (which would be misleading for a single-method payment) or
// silently failing the constraint (as raw "eWallet" did before). Reports
// already has dead `WHEN ... = 'wallet'` branches anticipating this value.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
  `);
  pgm.sql(`
    ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
      CHECK (payment_method IN ('cash','card','gift_card','split','upi','wallet'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
  `);
  pgm.sql(`
    ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
      CHECK (payment_method IN ('cash','card','gift_card','split','upi'));
  `);
};
