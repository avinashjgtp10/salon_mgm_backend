-- Migration: add staff_id and sale_id to client_memberships
-- Mirrors add_staff_id_and_sale_id_to_client_packages.sql for the same
-- reason: neither is captured today for membership sales, so there is no
-- way to show which staff member sold a membership or its invoice number.
--
-- staff_id is populated going forward by client-memberships.service.ts's
-- purchase() (standalone "sell membership" flow) and autoCreateFromPayment()
-- (membership sold as a line item on a checkout bill). sale_id is populated
-- right after recordTransaction()/the checkout's own sale is known.
--
-- Both columns are NULL for every pre-existing membership sale row.
--
-- NOT run automatically.

ALTER TABLE client_memberships
  ADD COLUMN IF NOT EXISTS staff_id UUID NULL REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_id  UUID NULL REFERENCES sales(id) ON DELETE SET NULL;
