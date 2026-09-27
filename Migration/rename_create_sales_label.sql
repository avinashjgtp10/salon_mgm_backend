-- "Create Sales" is the permission that actually gates opening Quick Sale at
-- all (sidebar nav, route guard, and GET /sales/init all check create_sales —
-- see DashboardRoutes.tsx, DashboardSidebar.tsx, sales.routes.ts). It sits in
-- the Roles & Permissions UI right next to "View Sales" (a narrower,
-- unrelated permission scoped to sales history/reports/getById), which reads
-- as if toggling "View Sales" should be what opens Quick Sale — it doesn't.
-- Relabeling create_sales so its name matches what it actually controls;
-- view_sales's own name/description/behavior is untouched.

UPDATE permissions
SET name = 'Access Quick Sale',
    description = 'Open Quick Sale and create, edit and checkout sales'
WHERE key = 'create_sales';
