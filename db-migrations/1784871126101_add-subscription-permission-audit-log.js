exports.shorthands = undefined;

// Audit trail for super-admin-managed per-salon subscription permission
// changes (see subscriptionPermission.middleware.ts / super-admin.repository
// .ts::updateSubscriptionPermissions). One row per save action, storing the
// full before/after permission map so "what changed" is always reconstructable
// — not just the latest state (which salon_settings already holds).
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS subscription_permission_audit_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id        UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      changed_by      UUID NOT NULL REFERENCES users(id),
      previous_value  JSONB,
      new_value       JSONB NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sub_perm_audit_salon_id
      ON subscription_permission_audit_log (salon_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS subscription_permission_audit_log;`);
};
