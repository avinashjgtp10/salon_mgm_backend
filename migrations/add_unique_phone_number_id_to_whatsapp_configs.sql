ALTER TABLE whatsapp_configs
  ADD CONSTRAINT whatsapp_configs_phone_number_id_unique UNIQUE (phone_number_id);
