exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS service_consultation_forms (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      service_id    UUID        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      name          TEXT        NOT NULL,
      is_selected   BOOLEAN     NOT NULL DEFAULT TRUE,
      field_values  JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_service_consultation_forms_service
      ON service_consultation_forms (service_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS service_consultation_forms;
  `);
};
