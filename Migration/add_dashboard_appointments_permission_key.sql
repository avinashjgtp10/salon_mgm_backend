INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_dashboard_appointments', 'View Dashboard Appointments', 'See today''s appointment preview on the Dashboard', 'Dashboard', NULL, 'view', 'medium', ARRAY['view_dashboard'])
ON CONFLICT (key) DO NOTHING;
