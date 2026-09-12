-- Clients permissions accordion ticket: manage_client_purchase_history
-- currently sits with group_name = NULL, landing it in the accidental
-- NULLS-FIRST ungrouped bucket instead of a real named "General" section —
-- same pattern already fixed for Reports/Settings/Online Booking's own
-- "General" groups. Clients' other 3 sections (Client History, Clients
-- List, Referral & Rewards) already have real group_name values and need
-- no change.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET group_name = 'General' WHERE key = 'manage_client_purchase_history';

COMMIT;
