-- Service Chain permissions: Marketing > Service Chains.
--
--   view_service_chains    see the list, steps and per-client enrolment log
--   manage_service_chains  create / edit / activate / delete a chain and cancel
--                          an individual client's journey
--
-- Owners and admins bypass every permission check, so nothing needs granting for
-- them; staff get access only by being granted these keys from Roles.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_service_chains',   'View Service Chains',   'Access Service Chains and their enrolment log',            'Marketing', 'Service Chains', 'view',   'low',    ARRAY['view_templates']),
  ('manage_service_chains', 'Manage Service Chains', 'Create, edit, activate or delete a Service Chain',         'Marketing', 'Service Chains', 'manage', 'medium', ARRAY['view_service_chains'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
