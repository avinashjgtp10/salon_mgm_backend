exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships ADD COLUMN IF NOT EXISTS loyalty_tiers JSONB;

    UPDATE memberships SET loyalty_tiers =
      jsonb_build_array(jsonb_build_object('thresholdValue', loyalty_threshold_value, 'discountPercent', discount_percent))
    WHERE pricing_type = 'loyalty' AND loyalty_tiers IS NULL AND loyalty_threshold_value IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE memberships DROP COLUMN IF EXISTS loyalty_tiers;
  `);
};
