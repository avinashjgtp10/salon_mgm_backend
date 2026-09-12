-- Bulk Billing Import: lets an owner/admin upload an Excel/CSV of historical
-- billing records and generate real dated `sales` rows from it. Billing rows
-- have no natural key of their own (unlike clients' phone number or
-- products' barcode/name), so duplicate-import protection has to happen at
-- the file/batch level instead — this table is that batch record, keyed by
-- (salon_id, file_hash) so re-uploading the exact same file is rejected
-- without risking false-positive skips of two genuinely distinct bills that
-- happen to share the same date/client/amount.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment.

CREATE TABLE IF NOT EXISTS sales_import_batches (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID          NOT NULL REFERENCES salons(id),
  filename       TEXT          NOT NULL,
  file_hash      TEXT          NOT NULL,
  uploaded_by    UUID,
  uploaded_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  total_rows     INT           NOT NULL DEFAULT 0,
  success_count  INT           NOT NULL DEFAULT 0,
  failed_count   INT           NOT NULL DEFAULT 0,
  skipped_count  INT           NOT NULL DEFAULT 0,
  total_billed   NUMERIC(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT sales_import_batches_salon_file_hash_key UNIQUE (salon_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_sales_import_batches_salon ON sales_import_batches(salon_id);

-- Traces every imported sale back to the file that created it — used both to
-- report "N invoices from this import" and, via the FK, to keep a batch from
-- being deleted while sales still reference it.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES sales_import_batches(id);
CREATE INDEX IF NOT EXISTS idx_sales_import_batch_id ON sales(import_batch_id);

-- New permission key for this feature — kept separate from the plain
-- `create_sales` key used by normal one-at-a-time checkout, since a single
-- import can write thousands of historical financial records at once and
-- has a materially larger blast radius. Mirrors the pattern in
-- add_gap_closure_permission_keys.sql. Defaults to owner/admin only (see
-- DEFAULT_STAFF_PERMS in permission.middleware.ts, which denies it to staff
-- unless a role explicitly grants it).
INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('import_sales', 'Import Billing Data', 'Bulk-import historical invoices from an Excel/CSV file', 'Quick Sale', NULL, 'manage', 'critical', ARRAY['create_sales'])
ON CONFLICT (key) DO NOTHING;
