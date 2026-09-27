-- The "+ Package" row in Quick Sale/Calendar reads catalog combo-packages via
-- GET /packages, which is gated by requirePlanFeature("packages"). Only
-- Advance/Pro tiers had that key — Basic-tier salons got a silent 403 on
-- every request, which the frontend swallowed as "no packages available"
-- (indistinguishable from genuinely-empty data; see AppointmentModal.tsx's
-- useLazyListPackagesQuery not checking the error state). Package templates
-- (/package-templates, the other half of the same dropdown) have no such
-- gate at all, so the two sources were inconsistently restricted by design,
-- not intent. Adding "packages" to Basic so both sources behave the same way
-- for every tier.

UPDATE salon_plan_definitions
SET feature_keys = feature_keys || '[
  {"key": "packages", "label": "Packages"}
]'::jsonb
WHERE tier = 'basic';
