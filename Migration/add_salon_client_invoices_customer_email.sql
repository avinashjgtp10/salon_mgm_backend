-- Create Invoice form now has a client-search autocomplete that also
-- pulls the customer's email; store it alongside the other customer
-- fields already on salon_client_invoices. Safe to re-run.

ALTER TABLE salon_client_invoices ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
