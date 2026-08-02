exports.shorthands = undefined;

// Consumables are deducted at the salon level (products.amount has no
// branch_id — it's already a single row per salon), not per-branch. The
// original consumable_usage.branch_id NOT NULL constraint (from the
// stock-reconciliation migration, where branch_id is genuinely meaningful —
// physical stock counts happen per branch) blocked any salon-level usage
// record. Made nullable rather than dropped: stock reconciliation's
// adjust_consumable path still legitimately writes a real branch_id here.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE consumable_usage ALTER COLUMN branch_id DROP NOT NULL;
  `);
};

exports.down = (pgm) => {
  // Not safely reversible without first backfilling every NULL branch_id
  // row — left as a no-op rather than guessing a branch.
};
