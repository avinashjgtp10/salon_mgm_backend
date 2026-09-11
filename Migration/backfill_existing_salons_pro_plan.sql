-- One-off backfill: existing salons created before super-admin account
-- creation started auto-assigning the Pro tier (see super-admin.repository.ts
-- createUser) were left with no salon_plan_customizations row, which the
-- salon-plans service silently treats as an implicit Basic tier. This gives
-- every such salon an explicit Pro row so they match newly created accounts.
INSERT INTO salon_plan_customizations (salon_id, base_tier)
SELECT s.id, 'pro'
FROM salons s
LEFT JOIN salon_plan_customizations spc ON spc.salon_id = s.id
WHERE spc.salon_id IS NULL
ON CONFLICT (salon_id) DO NOTHING;
