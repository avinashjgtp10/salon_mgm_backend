-- Lets a salon owner customize the order staff columns appear in on the
-- Scheduler (JIRA: Add Staff Sequence Management for Scheduler), independent
-- of Staff List's own default sort (active-before-inactive, Manager > Staff).
-- NULL = never explicitly sequenced — staff.repository.ts's list() sorts
-- these last when sort_by=scheduler_order, so newly added staff land at the
-- end of the Scheduler's columns rather than jumping to the front.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS scheduler_order INTEGER;
