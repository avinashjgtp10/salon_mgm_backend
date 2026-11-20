-- Spotlight floating video player: admin-managed, scheduled YouTube videos.
-- One row per video. The player on every salon dashboard shows at most ONE video at a time: the highest `priority` among the videos whose
-- schedule is active right now (see salon_mgm_frontend/src/features/feature-spotlight/utils/videoSchedule.ts).
--
-- Schedule (all wall-clock, read in each salon's own timezone by the app):
--   repeat_schedule = 'none'   : ONE continuous window, from start_date at start_time until end_date at end_time
--   repeat_schedule = 'daily'  : every day from start_date to end_date, between start_time and end_time
--   repeat_schedule = 'weekly' : same, but only on the weekday of start_date
-- playback_duration_minutes: how long ONE viewer's player stays on screen once it appears (not the schedule window, not the video's own length).
-- playback_behavior: what happens when the video ends before that time is up ('once' = stay on the last frame, 'loop' = replay).
--
-- Per project policy this file is created but NOT auto-run; apply it by hand against each environment (dev/QA/prod) in that order.
-- Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS spotlight_videos (
  id                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title                      VARCHAR(200) NOT NULL,
  youtube_url                TEXT         NOT NULL,
  youtube_video_id           VARCHAR(11)  NOT NULL,
  description                TEXT,
  is_enabled                 BOOLEAN      NOT NULL DEFAULT TRUE,
  show_floating_player       BOOLEAN      NOT NULL DEFAULT TRUE,
  auto_play                  BOOLEAN      NOT NULL DEFAULT TRUE,
  player_size                VARCHAR(10)  NOT NULL DEFAULT 'compact' CHECK (player_size IN ('compact', 'expanded')),
  start_date                 DATE         NOT NULL,
  end_date                   DATE         NOT NULL,
  start_time                 TIME         NOT NULL,
  end_time                   TIME         NOT NULL,
  playback_duration_minutes  INT          NOT NULL DEFAULT 15 CHECK (playback_duration_minutes BETWEEN 1 AND 1440),
  playback_behavior          VARCHAR(10)  NOT NULL DEFAULT 'once' CHECK (playback_behavior IN ('once', 'loop')),
  repeat_schedule            VARCHAR(10)  NOT NULL DEFAULT 'none' CHECK (repeat_schedule IN ('none', 'daily', 'weekly')),
  priority                   INT          NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  created_by                 UUID         REFERENCES users(id),
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_spotlight_video_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_spotlight_videos_playable ON spotlight_videos (is_enabled, show_floating_player, end_date);

COMMIT;
