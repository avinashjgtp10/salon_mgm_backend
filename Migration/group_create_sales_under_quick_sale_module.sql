-- create_sales is the actual permission that gates the Quick Sale screen and
-- creating/editing/deleting a sale (see sales.routes.ts) — but it was seeded
-- under module='Sales' (Migration/create_permissions_system_tables.sql),
-- alongside view_sales (a different concept: viewing past sales records/
-- reports), while the "Quick Sale" module group instead held 4 dead keys
-- (removed in remove_dead_quick_sale_permission_keys.sql). This regroups
-- create_sales into 'Quick Sale' so the toggle a salon owner actually uses
-- to control Quick Sale access lives in the module named for it.
--
-- view_sales stays under 'Sales' — it's a distinct, currently-unused-by-the-
-- frontend concept (viewing sales history/reports), out of scope here.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

UPDATE permissions
SET module = 'Quick Sale'
WHERE key = 'create_sales';
