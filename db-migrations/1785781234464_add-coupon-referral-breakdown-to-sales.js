exports.shorthands = undefined;

// Coupon code and a combined discount_amount (manual + coupon + referral +
// membership all merged together) were the only things ever persisted on a
// sale — the individual ₹ contribution of each discount source, the coupon's
// own id/type, and any referral trace at all were computed transiently for
// the checkout-time total and then discarded. Reports/Sale Details/receipts
// could show a coupon CODE but never the coupon's own discount amount, and
// had no way to show a Referral Discount line at all from the sales table.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales
      ADD COLUMN IF NOT EXISTS manual_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS coupon_id UUID,
      ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS coupon_discount_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS referral_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS referral_id UUID,
      ADD COLUMN IF NOT EXISTS referral_source VARCHAR(50);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sales
      DROP COLUMN IF EXISTS manual_discount_amount,
      DROP COLUMN IF EXISTS coupon_id,
      DROP COLUMN IF EXISTS coupon_discount_amount,
      DROP COLUMN IF EXISTS coupon_discount_type,
      DROP COLUMN IF EXISTS referral_discount_amount,
      DROP COLUMN IF EXISTS referral_id,
      DROP COLUMN IF EXISTS referral_source;
  `);
};
