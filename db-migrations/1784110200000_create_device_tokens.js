exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      salon_id        UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      expo_push_token TEXT        NOT NULL,
      platform        TEXT        NOT NULL CHECK (platform IN ('android', 'ios')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id
      ON device_tokens (user_id);

    CREATE INDEX IF NOT EXISTS idx_device_tokens_salon_id
      ON device_tokens (salon_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_expo_push_token
      ON device_tokens (expo_push_token);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS device_tokens;
  `);
};
