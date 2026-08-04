exports.shorthands = undefined;

// Memberships were flat-price-only (a fixed wallet balance to spend down).
// This adds a real "pricing type" so a plan can instead be a percentage-off
// discount benefit — `discount_percent` is only meaningful when
// pricing_type = 'percentage'. (client_memberships gets its own denormalized
// copy of these two columns via its own ensureTable() patch list in
// client-memberships.repository.ts, since that table's schema is
// self-managed at startup rather than through db-migrations — see the
// membership_wallet_balance/end_date columns there for the same pattern.)
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships
      ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(20) NOT NULL DEFAULT 'value',
      ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2);

    ALTER TABLE memberships
      ADD CONSTRAINT memberships_discount_percent_range
      CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));

    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS login_role VARCHAR(20) NOT NULL DEFAULT 'staff',
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

    ALTER TABLE staff
      DROP COLUMN IF EXISTS password;

    CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_discount_percent_range;
    ALTER TABLE memberships DROP COLUMN IF EXISTS pricing_type, DROP COLUMN IF EXISTS discount_percent;

    DROP INDEX IF EXISTS idx_staff_user_id;
    ALTER TABLE staff
      DROP COLUMN IF EXISTS user_id,
      DROP COLUMN IF EXISTS login_role;
  `);
};
