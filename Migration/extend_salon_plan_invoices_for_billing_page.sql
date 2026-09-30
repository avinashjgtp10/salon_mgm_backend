-- Super Admin > Billing & Invoices page redesign: subscription-billing GST
-- tax invoices (Monthly/Quarterly/Annual plan charges to a salon), rendered
-- as a real printable invoice with branch, payment mode, period range, GST
-- breakdown and bank details. Extends the existing salon_plan_invoices table
-- (previously only invoice_number/salon_id/plan_tier/amount/status/dates)
-- rather than creating a parallel table, since this is the exact same
-- subscription-billing concept BillingInvoicesTab.tsx already reads from.
-- Safe to re-run.

ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS invoice_no VARCHAR(40);
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS financial_year VARCHAR(10);
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS branch VARCHAR(120);
-- billing_cycle is the Monthly/Quarterly/Annual label shown on the invoice —
-- distinct from plan_tier (basic/advance/pro), which is the feature tier.
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly';
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(30);
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2);
ALTER TABLE salon_plan_invoices ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12,2) DEFAULT 0;

-- The status CHECK constraint predates 'failed' (only paid/open/overdue/void
-- existed) — the new page's status filter needs Paid/Pending/Failed, with
-- 'open' treated as this page's "Pending".
ALTER TABLE salon_plan_invoices DROP CONSTRAINT IF EXISTS salon_plan_invoices_status_check;
ALTER TABLE salon_plan_invoices ADD CONSTRAINT salon_plan_invoices_status_check
  CHECK (status IN ('paid', 'open', 'pending', 'overdue', 'failed', 'void'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_salon_plan_invoices_invoice_no ON salon_plan_invoices(invoice_no) WHERE invoice_no IS NOT NULL;

-- Per-salon, per-financial-year sequential counter for the FY2026-27/041
-- invoice number format — separate table from salon_gst_invoice_counters
-- (the client-invoice module's own counter) since these are two independent
-- numbering sequences.
CREATE TABLE IF NOT EXISTS salon_plan_invoice_counters (
  salon_id        UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  financial_year  VARCHAR(10) NOT NULL,
  next_seq        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (salon_id, financial_year)
);
