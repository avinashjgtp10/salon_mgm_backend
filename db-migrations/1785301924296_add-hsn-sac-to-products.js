exports.shorthands = undefined;

// GST (tax_type/custom_tax_rate) already existed on products but was never
// exposed in the Create/Edit Product UI. HSN/SAC (the tax classification
// code required alongside GST on Indian invoices) was parsed by the bulk
// import parser (products.import.ts) but had nowhere to go — no column
// existed, so it was silently dropped. This adds that column.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(20);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE products DROP COLUMN IF EXISTS hsn_sac;
  `);
};
