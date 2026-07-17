exports.shorthands = undefined;

// Package line items get their own item_type instead of being folded into
// 'service' (today's behavior, which makes package revenue indistinguishable
// from regular service revenue in reports).
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_item_type_check;
  `);
  pgm.sql(`
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_item_type_check
      CHECK (item_type IN ('service','product','membership','gift_card','quick','package'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sale_items DROP CONSTRAINT IF EXISTS sale_items_item_type_check;
  `);
  pgm.sql(`
    ALTER TABLE sale_items ADD CONSTRAINT sale_items_item_type_check
      CHECK (item_type IN ('service','product','membership','gift_card','quick'));
  `);
};
