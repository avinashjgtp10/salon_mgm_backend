-- Corrects add_feature_key_to_salon_plans.sql: that migration added
-- feature_keys as a bare string array, implicitly assumed to line up
-- index-for-index with the existing "features" (display name) array. It
-- doesn't — "features" is landing-page marketing copy (different count,
-- different wording) and feature_keys was seeded with the actual
-- enforcement key list from the product spec. Keeping them as two
-- separately-indexed arrays makes it impossible to know which key labels
-- which name.
--
-- Fix: feature_keys becomes a JSONB array of {key, label} objects — each
-- key is self-contained with its own admin-editable label, no pairing with
-- "features" required. "features" (the pricing-card marketing bullet list)
-- is untouched and stays independent.

UPDATE salon_plan_definitions SET feature_keys = '[
  {"key": "dashboard",       "label": "Dashboard"},
  {"key": "quick_sale",      "label": "Quick Sale"},
  {"key": "calendar",        "label": "Calendar"},
  {"key": "services",        "label": "Services"},
  {"key": "products",        "label": "Products"},
  {"key": "clients",         "label": "Customers/CRM"},
  {"key": "staff",           "label": "Staff"},
  {"key": "cash_management", "label": "Cash Management"},
  {"key": "reports",         "label": "Basic Reports"}
]'::jsonb WHERE tier = 'basic';

UPDATE salon_plan_definitions SET feature_keys = '[
  {"key": "inventory",          "label": "Inventory"},
  {"key": "staff_performance",  "label": "Staff Performance"},
  {"key": "advanced_reports",   "label": "Advanced Reports"},
  {"key": "offers_discounts",   "label": "Offers & Discounts"},
  {"key": "memberships",        "label": "Memberships"},
  {"key": "packages",           "label": "Packages"},
  {"key": "marketing",          "label": "Marketing"},
  {"key": "whatsapp_sms",       "label": "WhatsApp/SMS"},
  {"key": "data_export",        "label": "Data Export"},
  {"key": "payroll",            "label": "Payroll"}
]'::jsonb WHERE tier = 'advance';

UPDATE salon_plan_definitions SET feature_keys = '[
  {"key": "loyalty_program",             "label": "Loyalty Program"},
  {"key": "advanced_analytics",          "label": "Advanced Analytics"},
  {"key": "multi_branch",                "label": "Multiple Branches"},
  {"key": "advanced_permissions",        "label": "Advanced Permissions"},
  {"key": "customer_segmentation",       "label": "Customer Segmentation"},
  {"key": "api_integrations",            "label": "API & Integrations"},
  {"key": "advanced_financial_reports",  "label": "Advanced Financial Reports"},
  {"key": "priority_support",            "label": "Priority Support"}
]'::jsonb WHERE tier = 'pro';
