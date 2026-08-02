-- Migration: add staff_id and sale_id to client_packages
-- Package Sale report needs to show which staff member sold a package and
-- the invoice number for the sale. Neither exists today:
--   - client_packages has no staff_id column.
--   - The `sales` row created behind every package purchase (via
--     recordTransaction(), origin: "package_purchase") is never linked back
--     to the client_packages row that caused it, so it can't be joined
--     after the fact even though sales.staff_id/sales.invoice_number exist.
--
-- staff_id is populated going forward by client-packages.service.ts's
-- create() (passed through from a new "Staff" field on the sell-package
-- form). sale_id is populated by the same create() call, right after
-- recordTransaction() returns the new sales row's id.
--
-- Both columns are NULL for every pre-existing package sale row — the
-- report must treat NULL staff/invoice as "—", not an error.
--
-- NOT run automatically.

ALTER TABLE client_packages
  ADD COLUMN IF NOT EXISTS staff_id UUID NULL REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_id  UUID NULL REFERENCES sales(id) ON DELETE SET NULL;
