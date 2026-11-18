-- Settings > Role & Permission: "Client Number Visibility" — whether a staff role sees COMPLETE client mobile numbers (Show) or masked ones (Mask).
--
-- The key is "view_full_client_numbers": granted = Show, NOT granted = Mask. Not granted is the default on purpose: staff have always seen masked
-- numbers (e.g. 98******10), so nothing changes for any existing role or staff member until an owner sets one to Show.
-- The owner / admin always see complete numbers regardless of this permission.
--
-- No depends_on: it can be set on its own. Per project policy this file is created but NOT auto-run; apply it by hand against each
-- environment (dev/QA/prod) in that order. Safe to run more than once.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_full_client_numbers', 'Client Number Visibility',
   'Show: staff in this role see complete client mobile numbers. Mask: numbers are partly hidden (e.g. 98******10). The owner always sees complete numbers.',
   'Clients', 'Client Privacy', 'view', 'medium', NULL)
ON CONFLICT (key) DO NOTHING;

COMMIT;
