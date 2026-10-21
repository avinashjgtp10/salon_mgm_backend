-- Removes the LUNOX AI engine storage. Run by hand AFTER the backend that no longer references these is deployed.
DROP TABLE IF EXISTS ai_agent_logs;
DROP TABLE IF EXISTS ai_customer_memory;
DROP TABLE IF EXISTS ai_token_usage;
ALTER TABLE whatsapp_configs DROP COLUMN IF EXISTS ai_receptionist_enabled;
