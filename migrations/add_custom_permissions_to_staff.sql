-- Migration: add custom_permissions JSONB to staff table
-- When set, this overrides the global role_permissions for that specific staff member.
-- When NULL, the staff member falls back to the global role permissions.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS custom_permissions JSONB;
