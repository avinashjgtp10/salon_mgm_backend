-- Where the generated subscription-invoice PDF is stored (path relative to the invoice storage folder, see INVOICE_PDF_DIR).
-- The app also adds this column by itself the first time it needs it; run this by hand if the database user may not alter tables.
-- Additive and re-runnable.

ALTER TABLE subscription_invoices ADD COLUMN IF NOT EXISTS pdf_path TEXT;
