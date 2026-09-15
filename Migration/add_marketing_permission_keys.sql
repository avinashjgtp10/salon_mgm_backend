-- Marketing module permissions ticket — Dashboard / Analytics / Campaigns /
-- Templates / Scheduled Templates / Inbox / WhatsApp Config.
--
-- Backend routes for all 7 areas already had SOME permission check before
-- this ticket, but they were coarse: Dashboard, Analytics, Templates, and
-- Inbox all borrowed Campaigns' own view_campaigns/create_campaigns keys,
-- and Scheduled Templates borrowed the unrelated Automation module's
-- view_wa_automation/manage_wa_automation. This migration gives each of the
-- 7 areas its own dedicated keys per the ticket's exact lists, and
-- view_campaigns/create_campaigns (kept, already existed) become exclusively
-- Campaigns' own from here on — every other area stops referencing them.
--
-- A live-DB check before writing this confirmed zero grants exist anywhere
-- for any Marketing-related key (role_permissions or
-- staff_permission_overrides), so every route swap below is a clean
-- cutover, not a breaking change to an existing grant.
--
-- Campaigns: edit_campaign/delete_campaign are catalog-only — no Edit or
-- Delete Campaign action exists anywhere in the app today (a campaign, once
-- launched, can only be paused/resumed/resent/reported on), so these two
-- toggles have nothing to enforce yet. Added anyway because the ticket
-- explicitly asks for the toggles to exist. send_campaign covers the
-- existing resend/pause/resume actions (an existing campaign's send
-- lifecycle), distinct from create_campaigns (making a brand new one).
--
-- Scheduled Templates: create_scheduled_template is catalog-only — scheduled
-- messages are generated automatically by system jobs (birthday,
-- appointment reminders, membership/package expiry, etc.), never manually
-- created through any UI, so there's no create action to gate. Send Now
-- covers both send-now and retry-now (retrying is just sending again after
-- a failure); Delete covers both skip (this occurrence) and cancel (the
-- whole schedule) — the ticket's Edit/Delete split doesn't distinguish those
-- two, so both fold into whichever of Edit/Delete they're closer to.
--
-- Inbox: send_message and reply_to_conversation are two ticket-named
-- permissions for what is, in this app, the exact same single action (there
-- is no separate "compose new message" vs "reply" — every outbound message
-- is a reply within an existing conversation thread). Both keys are real
-- and independently grantable; the one Send button on the Inbox page is
-- OR'd across both so either toggle alone is enough to use it.
--
-- WhatsApp Config: splits the old manage_whatsapp_config (which gated reads
-- too) into a real view/edit pair — being trusted to LOOK at the connection
-- status is a materially lower-risk grant than being trusted to change the
-- credentials, matching how every other module in this app already
-- separates view from write.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  -- Dashboard
  ('view_marketing_dashboard',   'View Marketing Dashboard', 'Access the Marketing Dashboard overview',        'Marketing', 'Dashboard', 'view', 'low', NULL),

  -- Analytics
  ('view_marketing_analytics',   'View Marketing Analytics', 'Access Marketing Analytics reports',             'Marketing', 'Analytics', 'view', 'low', NULL),

  -- Campaigns (view_campaigns / create_campaigns already exist — see UPDATE below)
  ('edit_campaign',              'Edit Campaign',            'Edit an existing campaign',                      'Marketing', 'Campaigns', 'edit',   'medium', ARRAY['view_campaigns']),
  ('delete_campaign',            'Delete Campaign',          'Permanently delete a campaign',                  'Marketing', 'Campaigns', 'delete', 'high',   ARRAY['view_campaigns']),
  ('send_campaign',              'Send Campaign',            'Pause, resume, or resend an existing campaign',  'Marketing', 'Campaigns', 'manage', 'high',   ARRAY['view_campaigns']),

  -- Templates
  ('view_templates',             'View Templates',           'Access the WhatsApp Templates list',             'Marketing', 'Templates', 'view',   'low',    NULL),
  ('add_template',               'Add Template',             'Create a new WhatsApp template',                 'Marketing', 'Templates', 'create', 'medium', ARRAY['view_templates']),
  ('edit_template',              'Edit Template',             'Edit an existing WhatsApp template',             'Marketing', 'Templates', 'edit',   'medium', ARRAY['view_templates']),
  ('delete_template',            'Delete Template',          'Permanently delete a WhatsApp template',         'Marketing', 'Templates', 'delete', 'high',   ARRAY['view_templates']),

  -- Scheduled Templates
  ('view_scheduled_templates',       'View Scheduled Templates',        'Access the Scheduled Templates list',         'Marketing', 'Scheduled Templates', 'view',   'low',    NULL),
  ('create_scheduled_template',      'Create/Schedule Template',        'Manually schedule a template message',        'Marketing', 'Scheduled Templates', 'create', 'medium', ARRAY['view_scheduled_templates']),
  ('edit_scheduled_template',        'Edit Scheduled Template',         'Reschedule a pending scheduled message',      'Marketing', 'Scheduled Templates', 'edit',   'medium', ARRAY['view_scheduled_templates']),
  ('delete_scheduled_template',      'Delete Scheduled Template',       'Skip or cancel a scheduled message',          'Marketing', 'Scheduled Templates', 'delete', 'high',   ARRAY['view_scheduled_templates']),
  ('send_now_scheduled_template',    'Send Now',                       'Send a scheduled message immediately',        'Marketing', 'Scheduled Templates', 'manage', 'medium', ARRAY['view_scheduled_templates']),
  ('resend_scheduled_template',      'Resend',                         'Resend an already-sent scheduled message',    'Marketing', 'Scheduled Templates', 'manage', 'medium', ARRAY['view_scheduled_templates']),

  -- Inbox
  ('view_inbox',                 'View Inbox',                'Access the WhatsApp Inbox conversation list',   'Marketing', 'Inbox', 'view', 'low', NULL),
  ('view_conversation',          'View Conversation',         'Open and read a conversation thread',            'Marketing', 'Inbox', 'view', 'low', ARRAY['view_inbox']),
  ('send_message',               'Send Message',              'Send a WhatsApp message from the Inbox',         'Marketing', 'Inbox', 'manage', 'medium', ARRAY['view_inbox']),
  ('reply_to_conversation',      'Reply to Conversation',     'Reply within an existing conversation thread',   'Marketing', 'Inbox', 'manage', 'medium', ARRAY['view_inbox']),

  -- WhatsApp Config
  ('view_whatsapp_config',       'View WhatsApp Config',      'View the WhatsApp connection/configuration status', 'Marketing', 'WhatsApp Config', 'view', 'medium', NULL),
  ('edit_whatsapp_config',       'Edit/Update WhatsApp Configuration', 'Change WhatsApp API credentials and settings', 'Marketing', 'WhatsApp Config', 'edit', 'critical', ARRAY['view_whatsapp_config'])
ON CONFLICT (key) DO NOTHING;

UPDATE permissions SET group_name = 'Campaigns' WHERE module = 'Marketing' AND key IN ('view_campaigns', 'create_campaigns');

COMMIT;
