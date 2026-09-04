-- Salon staff register terminals by reading values straight off the
-- machine's own info screen (Serial No, MID, TID, Merchant Name, EDC
-- Payment App Version). TID was already captured (provider_terminal_id);
-- Serial No wasn't — added here purely for the salon's own record-keeping/
-- support use, not sent to Paytm's API (their Payment Request flow only
-- needs mid+tid).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment.

ALTER TABLE payment_terminals ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100);
