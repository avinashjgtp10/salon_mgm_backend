// "Block" and "Delete" were both implemented as `is_active = false` — the
// exact same flag — so a blocked client vanished from every client-list
// query (all of which filter `is_active = true`) exactly as if deleted,
// instead of staying visible/manageable with a "Blocked" badge like the UI
// already implies (block/unblock actions, block_reason field, "Blocked
// customers" bulk action). This gives "blocked" its own column so it's a
// state independent of "deleted".
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;
    -- Backfill: any client that was previously "blocked" via the old
    -- is_active=false + block_reason IS NOT NULL combination is now marked
    -- is_blocked=true AND restored to is_active=true (undoing the accidental
    -- soft-delete every prior block action caused).
    UPDATE clients SET is_blocked = true, is_active = true
    WHERE is_active = false AND block_reason IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_clients_is_blocked ON clients (is_blocked);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_clients_is_blocked;
    ALTER TABLE clients DROP COLUMN IF EXISTS is_blocked;
  `);
};
