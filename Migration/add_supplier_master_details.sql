-- Adds the fields needed by the redesigned Add Supplier form:
-- Supplier Code/Type, Contact Person, a flat Address line, Business & Tax
-- (GSTIN/PAN/Business Registration Number/Payment Terms/Credit Limit),
-- optional Bank Details, and Notes. Additive/nullable (or safe-defaulted) —
-- existing suppliers and every other reader of the `suppliers` table are
-- unaffected. First name/last name/description/street/suburb/postal_*
-- columns are NOT touched or dropped; they just stop being written by the
-- Add Supplier form going forward.

ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(20) NOT NULL DEFAULT 'product',
    ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255),
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS gstin VARCHAR(20),
    ADD COLUMN IF NOT EXISTS pan VARCHAR(10),
    ADD COLUMN IF NOT EXISTS business_registration_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bank_account_holder_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50),
    ADD COLUMN IF NOT EXISTS bank_ifsc_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE suppliers
    DROP CONSTRAINT IF EXISTS suppliers_supplier_type_check;
ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_supplier_type_check
    CHECK (supplier_type IN ('product', 'consumable', 'both'));

-- Per-salon sequence for auto-generated supplier codes (SPL-00001, ...),
-- same pattern as salons.next_purchase_seq / next_invoice_seq.
ALTER TABLE salons
    ADD COLUMN IF NOT EXISTS next_supplier_seq INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_salon_supplier_code_uq
    ON suppliers (salon_id, supplier_code)
    WHERE supplier_code IS NOT NULL;
