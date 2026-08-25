ALTER TABLE memberships        ADD COLUMN IF NOT EXISTS service_ids UUID[];
ALTER TABLE memberships        ADD COLUMN IF NOT EXISTS product_ids UUID[];
ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS service_ids UUID[];
ALTER TABLE client_memberships ADD COLUMN IF NOT EXISTS product_ids UUID[];
