exports.shorthands = undefined;

// Global (no salon_id) — a Super Admin broadcast banner shown on every
// account's dashboard during a deployment window. `status = 'stopped'`
// records a manual early-stop distinct from the window naturally elapsing
// (the latter is derived at read time by comparing end_time to NOW(), never
// written back).
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS deployment_announcements (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      message     TEXT        NOT NULL,
      start_time  TIMESTAMPTZ NOT NULL,
      end_time    TIMESTAMPTZ NOT NULL,
      status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
      created_by  UUID        REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_deployment_announcements_active_window
      ON deployment_announcements (status, start_time, end_time);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS deployment_announcements;
  `);
};
