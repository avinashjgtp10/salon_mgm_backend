-- Audit trail for Settings → Tax Mapping. One row per change to a tax configuration (created / updated / category reassigned /
-- deactivated). Before/after hold the tax's JSON value, so history survives later edits. Invoices are never touched.
-- Must be run manually. Saving a tax still works before it is run (the audit insert is skipped with a warning).
CREATE TABLE IF NOT EXISTS tax_config_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID NOT NULL,
  setting_id  UUID,
  tax_name    VARCHAR(255) NOT NULL,
  action      VARCHAR(40)  NOT NULL,
  before_value JSONB,
  after_value  JSONB,
  note        TEXT,
  changed_by  UUID,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_config_audit_salon ON tax_config_audit (salon_id, changed_at DESC);
