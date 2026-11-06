import { randomUUID } from 'crypto';
import pool from '../../config/database';

export interface BranchLogin {
  id: string;
  parent_salon_id: string;
  branch_owner_user_id: string;
  username: string;
  created_at: string;
}

export interface BranchLink {
  id: string;
  parent_salon_id: string;
  branch_salon_id: string;
  created_at: string;
}

export interface BranchLinkListRow extends BranchLink {
  branch_salon_name: string | null;
}

export const salonBranchesRepository = {
  async findUserByEmail(email: string) {
    const { rows } = await pool.query(
      `SELECT id, email, role, password_hash, is_active FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  },

  /** The salon this user OWNS (salons.owner_id) — deliberately not the staff fallback: staff must not be connectable. */
  async findOwnedSalon(userId: string): Promise<{ id: string; name: string | null; is_active: boolean | null } | null> {
    const { rows } = await pool.query(
      `SELECT id, business_name AS name, is_active FROM salons WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  },

  async findSalonName(salonId: string): Promise<string | null> {
    const { rows } = await pool.query(`SELECT business_name FROM salons WHERE id = $1`, [salonId]);
    return rows[0]?.business_name ?? null;
  },

  // ── Links ────────────────────────────────────────────────────────────────────

  async findByBranchSalon(branchSalonId: string): Promise<BranchLink | null> {
    const { rows } = await pool.query(`SELECT * FROM salon_branch_links WHERE branch_salon_id = $1`, [branchSalonId]);
    return rows[0] ?? null;
  },

  async countAsParent(parentSalonId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM salon_branch_links WHERE parent_salon_id = $1`,
      [parentSalonId],
    );
    return rows[0]?.n ?? 0;
  },

  async findByIdForParent(id: string, parentSalonId: string): Promise<BranchLink | null> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_branch_links WHERE id = $1 AND parent_salon_id = $2`,
      [id, parentSalonId],
    );
    return rows[0] ?? null;
  },

  async listByParent(parentSalonId: string): Promise<BranchLinkListRow[]> {
    const { rows } = await pool.query(
      `SELECT l.id, l.parent_salon_id, l.branch_salon_id, l.created_at, s.business_name AS branch_salon_name
         FROM salon_branch_links l
         JOIN salons s ON s.id = l.branch_salon_id
        WHERE l.parent_salon_id = $1
        ORDER BY l.created_at ASC`,
      [parentSalonId],
    );
    return rows;
  },

  // ── An existing branch owner connecting salons for themselves (Branch Owner portal > Settings) ───────────────

  async isAssignedToBranchOwner(branchOwnerId: string, salonId: string): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM branch_owner_salons WHERE branch_owner_id = $1 AND salon_id = $2`,
      [branchOwnerId, salonId],
    );
    return rows.length > 0;
  },

  async assignToBranchOwner(branchOwnerId: string, salonId: string): Promise<{ id: string }> {
    const { rows } = await pool.query(
      `INSERT INTO branch_owner_salons (branch_owner_id, salon_id, assigned_by) VALUES ($1,$2,$1)
       ON CONFLICT (branch_owner_id, salon_id) DO UPDATE SET branch_owner_id = EXCLUDED.branch_owner_id
       RETURNING id`,
      [branchOwnerId, salonId],
    );
    return rows[0];
  },

  /** Every salon this branch owner can enter. assigned_by = themselves means they connected it (and may disconnect it). */
  async listAssignedToBranchOwner(branchOwnerId: string): Promise<{
    id: string; salon_id: string; business_name: string | null; assigned_by: string | null; created_at: string;
  }[]> {
    const { rows } = await pool.query(
      `SELECT b.id, b.salon_id, s.business_name, b.assigned_by, b.created_at
         FROM branch_owner_salons b JOIN salons s ON s.id = b.salon_id
        WHERE b.branch_owner_id = $1
        ORDER BY b.created_at ASC`,
      [branchOwnerId],
    );
    return rows;
  },

  /** Only an assignment the branch owner made themselves can be removed here (not one a super admin made). */
  async removeSelfAssignment(id: string, branchOwnerId: string): Promise<{ salon_id: string } | null> {
    const { rows } = await pool.query(
      `DELETE FROM branch_owner_salons WHERE id = $1 AND branch_owner_id = $2 AND assigned_by = $2 RETURNING salon_id`,
      [id, branchOwnerId],
    );
    return rows[0] ?? null;
  },

  // ── Shared branch login ──────────────────────────────────────────────────────

  async findLoginByParent(parentSalonId: string): Promise<BranchLogin | null> {
    const { rows } = await pool.query(`SELECT * FROM salon_branch_logins WHERE parent_salon_id = $1`, [parentSalonId]);
    return rows[0] ?? null;
  },

  async findLoginByUsername(username: string): Promise<BranchLogin | null> {
    const { rows } = await pool.query(
      `SELECT * FROM salon_branch_logins WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [username],
    );
    return rows[0] ?? null;
  },

  /** The synthetic sign-in email of a username's branch_owner user (the normal login path then does the password check). */
  async findLoginEmailByUsername(username: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT u.email FROM salon_branch_logins l JOIN users u ON u.id = l.branch_owner_user_id
        WHERE LOWER(l.username) = LOWER($1) LIMIT 1`,
      [username],
    );
    return rows[0]?.email ?? null;
  },

  /**
   * Creates the shared branch login for a parent salon: a `branch_owner` user, its username row, and the salons it can
   * enter in the Branch Owner portal — the parent's own plus every link it already has (a database converted from the
   * first version has links but no login).
   */
  async createLogin(d: {
    parentSalonId: string; parentName: string | null; username: string; passwordHash: string; createdBy: string;
  }): Promise<BranchLogin> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Never typed by anyone: the username is the sign-in name, the email only has to be unique.
      const email = `branch-${randomUUID().slice(0, 8)}@branches.salonox.invalid`;
      const { rows: u } = await client.query(
        `INSERT INTO users (email, password_hash, first_name, role, is_verified, is_onboarding_complete)
         VALUES ($1,$2,$3,'branch_owner',TRUE,TRUE) RETURNING id`,
        [email, d.passwordHash, d.parentName?.trim() ? `${d.parentName.trim()} (branches)` : 'Branches'],
      );
      const { rows: l } = await client.query(
        `INSERT INTO salon_branch_logins (parent_salon_id, branch_owner_user_id, username, created_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [d.parentSalonId, u[0].id, d.username, d.createdBy],
      );
      await client.query(
        `INSERT INTO branch_owner_salons (branch_owner_id, salon_id, assigned_by)
         SELECT $1, s, $3 FROM (
           SELECT $2::uuid AS s
           UNION SELECT branch_salon_id FROM salon_branch_links WHERE parent_salon_id = $2
         ) t
         ON CONFLICT (branch_owner_id, salon_id) DO NOTHING`,
        [u[0].id, d.parentSalonId, d.createdBy],
      );
      await client.query('COMMIT');
      return l[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  /** Adds the link and lets the shared login (if there is one yet) enter that salon. */
  async insertLink(d: {
    parentSalonId: string; branchSalonId: string; createdBy: string; branchOwnerUserId: string | null;
  }): Promise<BranchLink> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO salon_branch_links (parent_salon_id, branch_salon_id, created_by) VALUES ($1,$2,$3) RETURNING *`,
        [d.parentSalonId, d.branchSalonId, d.createdBy],
      );
      if (d.branchOwnerUserId) {
        await client.query(
          `INSERT INTO branch_owner_salons (branch_owner_id, salon_id, assigned_by) VALUES ($1,$2,$3)
           ON CONFLICT (branch_owner_id, salon_id) DO NOTHING`,
          [d.branchOwnerUserId, d.branchSalonId, d.createdBy],
        );
      }
      await client.query('COMMIT');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async removeLink(linkId: string, branchSalonId: string, branchOwnerUserId: string | null): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM salon_branch_links WHERE id = $1`, [linkId]);
      if (branchOwnerUserId) {
        await client.query(`DELETE FROM branch_owner_salons WHERE branch_owner_id = $1 AND salon_id = $2`, [branchOwnerUserId, branchSalonId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async updateLogin(login: BranchLogin, fields: { username?: string; passwordHash?: string }): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (fields.username) {
        await client.query(`UPDATE salon_branch_logins SET username = $2, updated_at = NOW() WHERE id = $1`, [login.id, fields.username]);
      }
      if (fields.passwordHash) {
        await client.query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [login.branch_owner_user_id, fields.passwordHash]);
        // A new password signs the old one out everywhere.
        await client.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [login.branch_owner_user_id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async audit(d: {
    parentSalonId: string | null; branchSalonId: string | null; actorUserId: string | null;
    action: string; ip?: string | null; userAgent?: string | null;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO salon_branch_audit (parent_salon_id, branch_salon_id, actor_user_id, action, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [d.parentSalonId, d.branchSalonId, d.actorUserId, d.action, d.ip ?? null, d.userAgent ?? null],
    );
  },
};
