-- Real Active/Inactive status for suppliers. No such column existed before
-- this — a prior memory's claim otherwise was verified false (checked
-- inventory.repository.ts, AddSupplierPage.tsx, and every supplier
-- migration directly; nothing referenced is_active for suppliers anywhere).

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
