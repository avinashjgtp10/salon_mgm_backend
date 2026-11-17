-- Activity History: Work Status gains Pending, In Progress and Cancelled (existing values stay valid).
ALTER TABLE client_activity_logs DROP CONSTRAINT IF EXISTS chk_activity_work_status;
ALTER TABLE client_activity_logs ADD CONSTRAINT chk_activity_work_status CHECK (work_status IS NULL OR work_status IN
  ('pending','in_progress','completed','cancelled','pending_us','pending_client','not_completed'));
