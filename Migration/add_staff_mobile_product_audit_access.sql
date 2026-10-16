-- Mobile app: per-staff "Product Audit access" switch.
--
-- When ON, the staff member can view audits and perform them (create an audit,
-- count and scan products, add a product the scanner doesn't know, submit for
-- review) in the SalonOX mobile app, even
-- without the matching Roles & Permissions grants. Approving/rejecting stays
-- with Roles & Permissions (approve_product_audit). It applies only to
-- requests sent by the mobile app (X-Salonox-Client: mobile) — the web app
-- keeps using Roles & Permissions alone. OFF (the default) keeps every staff
-- member exactly as before.
--
-- Every read of this column is column-existence-aware (see
-- mobile-staff/mobileProductAuditAccess.ts), so permission checks keep
-- working, with the switch simply off, until this has been run. Saving the
-- switch does need it — run this before deploying the backend/mobile app.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS mobile_product_audit_access BOOLEAN NOT NULL DEFAULT FALSE;
