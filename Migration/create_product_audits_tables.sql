-- Product Audit: count physical stock against system quantities and
-- reconcile differences. Read-only against system quantities — this module
-- never writes to products.amount or stock_movements (unlike Stock Takes'
-- /stock-take processing endpoint), matching the ticket's "no real inventory
-- adjustment" requirement while still being fully persisted.

CREATE TABLE IF NOT EXISTS product_audits (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL,
  branch_id         UUID          NOT NULL,
  name              VARCHAR(200)  NOT NULL,
  notes             TEXT,
  status            VARCHAR(20)   NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'pending_review', 'complete', 'rejected')),
  auditor_id        UUID          NOT NULL,
  reviewer_id       UUID,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_audits_salon_branch ON product_audits(salon_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_product_audits_status ON product_audits(status);

CREATE TABLE IF NOT EXISTS product_audit_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id          UUID          NOT NULL REFERENCES product_audits(id) ON DELETE CASCADE,
  product_id        UUID          NOT NULL REFERENCES products(id),
  -- Snapshotted at add-time so a later stock change elsewhere doesn't rewrite
  -- history for an audit that's already counted this line.
  system_qty        NUMERIC(12,3) NOT NULL,
  physical_qty      NUMERIC(12,3),
  reason            TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (audit_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_product_audit_items_audit ON product_audit_items(audit_id);

CREATE TABLE IF NOT EXISTS product_audit_history (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id          UUID          NOT NULL REFERENCES product_audits(id) ON DELETE CASCADE,
  actor_id          UUID,
  action            VARCHAR(100)  NOT NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_audit_history_audit ON product_audit_history(audit_id);
