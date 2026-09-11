-- view_sales gates viewing sales records/summary/export (sales.routes.ts:
-- GET /, /summary, /export, /staff/:staffId/items, /:id) — a reporting/
-- viewing concept, not the Quick Sale action screen (that's create_sales,
-- already moved to module='Quick Sale' — see
-- group_create_sales_under_quick_sale_module.sql). Left alone it was the
-- lone item in its own "Sales" section in Settings -> Roles & Permissions;
-- regrouped under "Reports" instead, where it fits conceptually. The
-- permission itself, its enforcement, and its ability to be granted are
-- unchanged — this only moves which section it displays under.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

UPDATE permissions
SET module = 'Reports'
WHERE key = 'view_sales';
