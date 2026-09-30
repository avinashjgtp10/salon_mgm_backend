-- client_requirement_assignees.developer_id originally FK'd to users(id)
-- (back when "developer" meant a users.role='super_admin' row) — repoint it
-- to the new standalone developers table instead. The table is new in this
-- environment (no prior assignee rows reference real developers yet), so
-- this drops and recreates the FK rather than attempting any data migration.
ALTER TABLE client_requirement_assignees DROP CONSTRAINT IF EXISTS client_requirement_assignees_developer_id_fkey;
ALTER TABLE client_requirement_assignees
  ADD CONSTRAINT client_requirement_assignees_developer_id_fkey
  FOREIGN KEY (developer_id) REFERENCES developers(id) ON DELETE CASCADE;

-- client_requirements.assigned_to (legacy single-assignee column) — same
-- repoint, for the older assign() endpoint.
ALTER TABLE client_requirements DROP CONSTRAINT IF EXISTS client_requirements_assigned_to_fkey;
ALTER TABLE client_requirements
  ADD CONSTRAINT client_requirements_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES developers(id) ON DELETE SET NULL;
