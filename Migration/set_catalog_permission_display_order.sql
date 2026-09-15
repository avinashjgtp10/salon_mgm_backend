-- Catalog permissions (Services/Digital Menu/Products/Packages/Memberships)
-- were sorting by the hidden `action` column (create/delete/edit/view/...
-- alphabetically) since display_order was NULL on every row — that's why
-- "View Services" landed dead last instead of first, and CRUD/import/
-- export rows appeared in a non-obvious order. Pins each section's own
-- View master first (it's now also the reveal-on-toggle parent — see
-- permissionCascade.ts), then CRUD, then the rest, then downloads
-- (CSV/Excel/PDF, matching the order already used elsewhere in this
-- project). Packages has 3 independent master/children clusters
-- (Packages, Client Packages, Package Templates) — each cluster's own
-- View sits directly above its own children, in that reading order.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

-- Services
UPDATE permissions SET display_order = 0  WHERE key = 'view_services';
UPDATE permissions SET display_order = 1  WHERE key = 'create_services';
UPDATE permissions SET display_order = 2  WHERE key = 'edit_services';
UPDATE permissions SET display_order = 3  WHERE key = 'delete_services';
UPDATE permissions SET display_order = 4  WHERE key = 'import_services';
UPDATE permissions SET display_order = 5  WHERE key = 'manage_categories';
UPDATE permissions SET display_order = 6  WHERE key = 'print_menu_card';
UPDATE permissions SET display_order = 7  WHERE key = 'download_service_menu_csv';
UPDATE permissions SET display_order = 8  WHERE key = 'download_service_menu_excel';
UPDATE permissions SET display_order = 9  WHERE key = 'download_service_menu_pdf';

-- Digital Menu
UPDATE permissions SET display_order = 0  WHERE key = 'view_digital_menu';
UPDATE permissions SET display_order = 1  WHERE key = 'create_digital_menu';
UPDATE permissions SET display_order = 2  WHERE key = 'edit_digital_menu';
UPDATE permissions SET display_order = 3  WHERE key = 'enable_disable_digital_menu';
UPDATE permissions SET display_order = 4  WHERE key = 'manage_digital_menu_qr';

-- Products
UPDATE permissions SET display_order = 0  WHERE key = 'view_products';
UPDATE permissions SET display_order = 1  WHERE key = 'create_products';
UPDATE permissions SET display_order = 2  WHERE key = 'edit_products';
UPDATE permissions SET display_order = 3  WHERE key = 'delete_products';
UPDATE permissions SET display_order = 4  WHERE key = 'import_products';
UPDATE permissions SET display_order = 5  WHERE key = 'download_products_csv';
UPDATE permissions SET display_order = 6  WHERE key = 'download_products_excel';
UPDATE permissions SET display_order = 7  WHERE key = 'download_products_pdf';

-- Memberships
UPDATE permissions SET display_order = 0  WHERE key = 'view_memberships';
UPDATE permissions SET display_order = 1  WHERE key = 'create_memberships';
UPDATE permissions SET display_order = 2  WHERE key = 'edit_memberships';
UPDATE permissions SET display_order = 3  WHERE key = 'delete_memberships';
UPDATE permissions SET display_order = 4  WHERE key = 'download_membership_csv';
UPDATE permissions SET display_order = 5  WHERE key = 'download_membership_excel';
UPDATE permissions SET display_order = 6  WHERE key = 'download_membership_pdf';

-- Packages: 3 clusters (Packages / Client Packages / Package Templates),
-- each cluster's own View directly above its own children.
UPDATE permissions SET display_order = 0  WHERE key = 'view_packages';
UPDATE permissions SET display_order = 1  WHERE key = 'create_packages';
UPDATE permissions SET display_order = 2  WHERE key = 'edit_packages';
UPDATE permissions SET display_order = 3  WHERE key = 'delete_packages';
UPDATE permissions SET display_order = 4  WHERE key = 'view_client_packages';
UPDATE permissions SET display_order = 5  WHERE key = 'create_package';
UPDATE permissions SET display_order = 6  WHERE key = 'edit_package';
UPDATE permissions SET display_order = 7  WHERE key = 'delete_package';
UPDATE permissions SET display_order = 8  WHERE key = 'view_package_templates';
UPDATE permissions SET display_order = 9  WHERE key = 'add_package_template';
UPDATE permissions SET display_order = 10 WHERE key = 'edit_package_template';
UPDATE permissions SET display_order = 11 WHERE key = 'delete_package_template';

COMMIT;
