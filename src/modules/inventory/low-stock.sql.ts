// One definition of "is this product low on stock", as SQL, so Product
// Inventory, Consumable Inventory, the products list filter, alerts, branch-owner
// and the reports can never disagree.
//
// Low Stock Alert is configured like Available Stock: Product Quantity ×
// Unit Size (in the product's unit). The threshold, in BASE units (ml/g/pcs —
// the same unit products.amount is stored in), is therefore
//
//     threshold = qty_alert (Product Quantity) × alert Unit Size
//
// and a product is low when amount <= threshold. products.qty_alert stays the
// Product Quantity half; the Unit Size half lives in qty_alert_unit_size.
// Where that is NULL (every product saved before this existed, and any alert
// whose unit size is just the product's own) the product's bottle_size is used,
// and a product with no bottle_size counts in single units — which makes this
// exactly equal to the old "CEIL(stock in packs) <= qty_alert" rule, so
// nothing already configured changes meaning.
//
// to_jsonb(<row>) is used to read qty_alert_unit_size so that every one of
// these queries keeps working on a database that hasn't run
// Migration/add_qty_alert_unit_size.sql yet (the field then just reads NULL),
// instead of failing with "column does not exist".

/** The alert's own Unit Size, or NULL when unset / column not migrated yet. */
export const alertUnitSizeSql = (alias = "p"): string =>
  `NULLIF(to_jsonb(${alias})->>'qty_alert_unit_size', '')::numeric`;

/** Unit Size actually applied to the alert's Product Quantity. */
export const effectiveAlertUnitSizeSql = (alias = "p"): string =>
  `COALESCE(NULLIF(${alertUnitSizeSql(alias)}, 0), NULLIF(${alias}.bottle_size, 0), 1)`;

/** Low-stock threshold in base units, as SQL. NULL when no alert is set. */
export const lowStockThresholdSql = (alias = "p"): string =>
  `(${alias}.qty_alert * ${effectiveAlertUnitSizeSql(alias)})`;

/** Boolean SQL: an alert is configured and stock has reached/fallen below it. */
export const isLowStockSql = (alias = "p"): string =>
  `(${alias}.qty_alert IS NOT NULL AND ${alias}.qty_alert > 0 AND COALESCE(${alias}.amount, 0) <= ${lowStockThresholdSql(alias)})`;

/** Same rule in JS, for code that already holds the row (alerts service). */
export function lowStockThreshold(row: {
  qty_alert: number | string | null;
  qty_alert_unit_size?: number | string | null;
  bottle_size?: number | string | null;
}): number | null {
  const qty = Number(row.qty_alert);
  if (row.qty_alert == null || !Number.isFinite(qty) || qty <= 0) return null;
  const size = Number(row.qty_alert_unit_size) || Number(row.bottle_size) || 1;
  return qty * size;
}
