exports.shorthands = undefined;

// sale_items never carried its own tax figure — GST was only ever computed
// and stored once per whole sale (sales.tax_amount), via pricing.engine.ts's
// per-BUCKET (service/package/product/membership) calculation. Per-item
// reports (Service Sale Report, Package Sale Report, product revenue) need a
// real per-row GST figure, not a bucket lump sum. NOT NULL DEFAULT 0 needs no
// backfill — historical rows correctly show ₹0 per-item tax, same as today's
// "nothing shown"; sales.tax_amount remains the untouched, authoritative
// bill-level figure for old and new sales alike.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sale_items
      ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tax_amount     NUMERIC(10,2) NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sale_items DROP COLUMN IF EXISTS taxable_amount;
    ALTER TABLE sale_items DROP COLUMN IF EXISTS tax_amount;
  `);
};
