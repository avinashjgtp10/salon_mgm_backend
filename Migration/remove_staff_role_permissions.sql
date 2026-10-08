-- Removes every permission grant from the default "Staff" role in every salon.
-- Manager (and any custom role) is untouched. Owner/Admin are not rows here.
--
-- Matches by role name (case-insensitive) since the seeded Staff role is an
-- ordinary row in `roles`; a salon-renamed Staff role will not be matched.
-- Manager permissions are NOT touched: only role_permissions rows of the Staff
-- role are deleted. The legacy salon_settings 'role_permissions' blob (which
-- also carries manager values) is left as-is; the middleware no longer reads
-- its staff values.
--
-- Effect: staff on the Staff role lose ALL access until a role/override
-- grants it again. Run by hand, dev first. Not wired to app startup.

BEGIN;

DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE LOWER(name) = 'staff');

COMMIT;
