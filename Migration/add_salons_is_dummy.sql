-- Super Admin splits salons into "Real Salons" and "Dummy Salons" (demo/test
-- accounts). Existing salons stay real. A salon can be moved either way.
-- Per project policy this file is created but NOT auto-run; apply by hand.
BEGIN;
ALTER TABLE salons ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_salons_is_dummy ON salons(is_dummy);
COMMIT;
