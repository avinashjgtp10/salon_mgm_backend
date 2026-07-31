exports.shorthands = undefined;

/**
 * A salon is created only by the final onboarding transaction. Historical
 * owners that already have a salon therefore completed onboarding, even when
 * the canonical user flag was left false by older application code.
 *
 * Updating the canonical flag is sufficient: users_onboarding_to_salons keeps
 * the backwards-compatible salons.onboarding_completed column synchronized.
 */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE users u
       SET is_onboarding_complete = TRUE,
           updated_at = NOW()
     WHERE u.is_onboarding_complete = FALSE
       AND EXISTS (
         SELECT 1
           FROM salons s
          WHERE s.owner_id = u.id
       );
  `);
};

// Historical completion cannot be safely inferred in reverse. Reverting this
// migration must not force legitimately completed owners back to false.
exports.down = () => {};
