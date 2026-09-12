-- Online Booking and Enquiries are real sidebar sections
-- (DashboardSidebar.tsx) that had no featureKey at all yet — every salon
-- saw them regardless of plan since nothing gated them. Adding as Basic-tier
-- core-ops keys, same tier as Clients/Calendar/Staff, so existing behavior
-- (visible to everyone) is preserved by default; a super admin can still
-- override them off per salon via feature_overrides.

UPDATE salon_plan_definitions
SET feature_keys = feature_keys || '[
  {"key": "online_booking", "label": "Online Booking"},
  {"key": "enquiries",      "label": "Enquiries"}
]'::jsonb
WHERE tier = 'basic';
