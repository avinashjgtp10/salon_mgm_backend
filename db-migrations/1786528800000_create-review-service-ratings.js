exports.shorthands = undefined;

// Redesigns the public feedback form's storage: an overall 1-5 rating plus
// one rating per service line in the appointment (not just one rating for
// the whole visit), a fixed-enum "what can we improve" multi-select, and a
// free-text comment box. Per-service ratings need their own relational rows
// (not another JSONB blob) so later reporting can GROUP BY staff/service
// across appointments — same reasoning and shape as
// appointment_service_consumables (1785900100000): service_row_id matches
// the `id` on one item inside appointments.services JSONB, so it's NOT a
// foreign key, just a string key unique within one appointment.
//
// Also adds salons.google_review_url — a salon-owned external link (same
// shape as the existing website_url column) that the feedback thank-you
// screen uses to prompt happy customers to also leave a Google review.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE reviews
      ADD COLUMN IF NOT EXISTS overall_rating      SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
      ADD COLUMN IF NOT EXISTS improvement_tags     TEXT[],
      ADD COLUMN IF NOT EXISTS additional_comments  TEXT;

    CREATE TABLE IF NOT EXISTS review_service_ratings (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id       UUID        NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      appointment_id  UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      service_row_id  TEXT        NOT NULL,
      service_id      UUID        REFERENCES services(id) ON DELETE SET NULL,
      service_name    TEXT        NOT NULL,
      staff_id        UUID        REFERENCES users(id),
      staff_name      TEXT,
      rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment         TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (appointment_id, service_row_id)
    );

    CREATE INDEX IF NOT EXISTS idx_rsr_review ON review_service_ratings (review_id);
    CREATE INDEX IF NOT EXISTS idx_rsr_staff  ON review_service_ratings (staff_id) WHERE staff_id IS NOT NULL;

    ALTER TABLE salons
      ADD COLUMN IF NOT EXISTS google_review_url TEXT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS review_service_ratings;
    ALTER TABLE reviews
      DROP COLUMN IF EXISTS overall_rating,
      DROP COLUMN IF EXISTS improvement_tags,
      DROP COLUMN IF EXISTS additional_comments;
    ALTER TABLE salons
      DROP COLUMN IF EXISTS google_review_url;
  `);
};
