-- "Manage My Brands" (Catalog > Product List > Options > Manage my brands)
-- was completely ungated — no frontend check, and its backend routes
-- (GET/POST/PATCH /products/brands) piggybacked on view_products/
-- create_products. The ticket requires this to be its own independent
-- permission, not coupled to View/Create Product, so it gets a standalone
-- key with no depends_on — same shape as view_client_packages/
-- view_package_templates.

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('manage_my_brands', 'Manage My Brands', 'Create and delete product brands from the Products page', 'Catalog', 'Products', 'manage', 'medium', NULL)
ON CONFLICT (key) DO NOTHING;
