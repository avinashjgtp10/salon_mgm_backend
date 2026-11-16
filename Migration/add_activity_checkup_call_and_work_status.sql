-- Activity History: new "Check-up Call" type and a single Work Status (replaces Work Completed / Pending Work in the form).
ALTER TABLE client_activity_logs ADD COLUMN IF NOT EXISTS work_status VARCHAR(20);
ALTER TABLE client_activity_logs DROP CONSTRAINT IF EXISTS chk_activity_type;
ALTER TABLE client_activity_logs ADD CONSTRAINT chk_activity_type CHECK (activity_type IN
  ('meeting','training','salon_visit','phone_call','checkup_call','whatsapp_discussion','technical_support','implementation','client_feedback','general'));
ALTER TABLE client_activity_logs DROP CONSTRAINT IF EXISTS chk_activity_work_status;
ALTER TABLE client_activity_logs ADD CONSTRAINT chk_activity_work_status CHECK (work_status IS NULL OR work_status IN ('pending_client','pending_us','completed','not_completed'));
