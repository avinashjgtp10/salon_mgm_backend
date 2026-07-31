exports.shorthands = undefined;

/**
 * users.is_onboarding_complete is canonical. The salon column remains only
 * for backwards compatibility and is maintained entirely by PostgreSQL.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ALTER COLUMN is_onboarding_complete SET DEFAULT FALSE;
    UPDATE users
       SET is_onboarding_complete = FALSE
     WHERE is_onboarding_complete IS NULL;
    ALTER TABLE users
      ALTER COLUMN is_onboarding_complete SET NOT NULL;

    UPDATE salons s
       SET onboarding_completed = COALESCE(u.is_onboarding_complete, FALSE),
           updated_at = NOW()
      FROM users u
     WHERE u.id = s.owner_id
       AND s.onboarding_completed IS DISTINCT FROM COALESCE(u.is_onboarding_complete, FALSE);

    UPDATE salons SET onboarding_completed = FALSE WHERE onboarding_completed IS NULL;
    ALTER TABLE salons
      ALTER COLUMN onboarding_completed SET DEFAULT FALSE,
      ALTER COLUMN onboarding_completed SET NOT NULL;

    CREATE OR REPLACE FUNCTION sync_salon_onboarding_from_owner()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      SELECT COALESCE(is_onboarding_complete, FALSE)
        INTO NEW.onboarding_completed
        FROM users
       WHERE id = NEW.owner_id;
      NEW.onboarding_completed := COALESCE(NEW.onboarding_completed, FALSE);
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS salons_onboarding_from_owner ON salons;
    CREATE TRIGGER salons_onboarding_from_owner
      BEFORE INSERT OR UPDATE OF onboarding_completed, owner_id ON salons
      FOR EACH ROW EXECUTE FUNCTION sync_salon_onboarding_from_owner();

    CREATE OR REPLACE FUNCTION sync_owner_onboarding_to_salons()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE salons
         SET onboarding_completed = COALESCE(NEW.is_onboarding_complete, FALSE),
             updated_at = NOW()
       WHERE owner_id = NEW.id
         AND onboarding_completed IS DISTINCT FROM COALESCE(NEW.is_onboarding_complete, FALSE);
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS users_onboarding_to_salons ON users;
    CREATE TRIGGER users_onboarding_to_salons
      AFTER INSERT OR UPDATE OF is_onboarding_complete ON users
      FOR EACH ROW EXECUTE FUNCTION sync_owner_onboarding_to_salons();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS users_onboarding_to_salons ON users;
    DROP TRIGGER IF EXISTS salons_onboarding_from_owner ON salons;
    DROP FUNCTION IF EXISTS sync_owner_onboarding_to_salons();
    DROP FUNCTION IF EXISTS sync_salon_onboarding_from_owner();
  `);
};
