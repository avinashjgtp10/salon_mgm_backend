-- Super Admin > Billing & Invoices: a salon's own client-facing GST tax
-- invoices (haircut/spa/product line items with SAC codes), distinct from
-- the existing SaaS subscription billing (salons table / subscriptions
-- module). Safe to re-run.

CREATE TABLE IF NOT EXISTS salon_client_invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id           UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  invoice_no         VARCHAR(40) NOT NULL,
  financial_year     VARCHAR(10) NOT NULL, -- e.g. "2026-27"
  invoice_date       DATE NOT NULL,
  branch             VARCHAR(120),
  customer_name      VARCHAR(255) NOT NULL,
  customer_address   TEXT,
  customer_contact   VARCHAR(30),
  staff_name         VARCHAR(120),
  payment_mode       VARCHAR(30),
  status             VARCHAR(20) NOT NULL DEFAULT 'pending', -- paid | pending | failed
  subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (salon_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS idx_salon_client_invoices_salon_id ON salon_client_invoices(salon_id);
CREATE INDEX IF NOT EXISTS idx_salon_client_invoices_date ON salon_client_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_salon_client_invoices_status ON salon_client_invoices(status);

CREATE TABLE IF NOT EXISTS salon_client_invoice_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES salon_client_invoices(id) ON DELETE CASCADE,
  description  VARCHAR(255) NOT NULL,
  sac_code     VARCHAR(20),
  qty          NUMERIC(10,2) NOT NULL DEFAULT 1,
  rate         NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salon_client_invoice_items_invoice_id ON salon_client_invoice_items(invoice_id);

-- Per-salon, per-financial-year sequential invoice numbering, following the
-- same UPDATE...RETURNING counter pattern as salons.next_invoice_seq (see
-- sales.repository.ts) rather than a DB SEQUENCE object, since the counter
-- must reset per financial year rather than grow forever.
--
-- Named salon_gst_invoice_counters (not salon_invoice_counters) — a table
-- with that more obvious name already exists in the schema for an unrelated
-- purpose (salon_id, next_number, no financial_year column; only referenced
-- from the salon-data-cleanup table list in salons.repository.ts), so this
-- uses a distinct name rather than colliding with it.
CREATE TABLE IF NOT EXISTS salon_gst_invoice_counters (
  salon_id        UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  financial_year  VARCHAR(10) NOT NULL,
  next_seq        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (salon_id, financial_year)
);

-- Salon's own bank account, printed on the tax invoice for NEFT/RTGS
-- payments — no such table/columns existed anywhere in the schema before.
ALTER TABLE salons ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120);
ALTER TABLE salons ADD COLUMN IF NOT EXISTS bank_account_holder VARCHAR(120);
ALTER TABLE salons ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40);
ALTER TABLE salons ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20);
ALTER TABLE salons ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(120);
ALTER TABLE salons ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(20);
