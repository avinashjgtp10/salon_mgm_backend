-- Online Booking permissions ticket: Settings → Roles & Permissions →
-- Online Booking → Channels gets 4 independent View toggles — Marketplace,
-- Reserve with Google, Facebook & Instagram, Link Builder — layered on top
-- of the existing single view_booking gate that covers the whole module.
--
-- depends_on view_booking (not a standalone top-level key) — same pattern
-- as add_enquiries/edit_enquiries depending on view_enquiries: toggling a
-- channel ON in the Roles & Permissions UI auto-enables view_booking too,
-- since a channel is meaningless without module access, but the dependency
-- is UI-cascade only, not re-checked server-side (each channel's own route
-- checks only its own key, mirroring the Enquiries split).
--
-- Reserve with Google and Facebook & Instagram have no backend module at
-- all today (frontend-only mockups, per the online-booking/marketplace
-- audit) — their permission is enforced purely by the frontend route guard;
-- nothing to gate server-side for those two.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on)
VALUES
  ('view_marketplace', 'Marketplace', 'Access the Marketplace profile channel', 'Online Booking', 'Channels', 'view', 'low', ARRAY['view_booking']),
  ('view_reserve_with_google', 'Reserve with Google', 'Access the Reserve with Google channel', 'Online Booking', 'Channels', 'view', 'low', ARRAY['view_booking']),
  ('view_social_bookings', 'Facebook & Instagram', 'Access the Facebook & Instagram booking channel', 'Online Booking', 'Channels', 'view', 'low', ARRAY['view_booking']),
  ('view_link_builder', 'Link Builder', 'Access the Link Builder channel', 'Online Booking', 'Channels', 'view', 'low', ARRAY['view_booking'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
