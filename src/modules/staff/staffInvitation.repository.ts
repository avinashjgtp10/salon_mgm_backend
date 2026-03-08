import pool from "../../config/database";
import crypto from "crypto";
import { StaffInvitation } from "./staff.types";

const TOKEN_EXPIRY_HOURS = 72;

type InvitationStatus = "pending" | "accepted" | "expired" | "cancelled";

type StaffInviteRow = {
  id: string;
  email: string | null;

  invitation_token: string | null;
  invitation_status: InvitationStatus | null;
  invitation_expires_at: string | null;
  invitation_accepted_at: string | null;

  created_at: string;  // from staff table
  updated_at: string;  // from staff table
};

const toInvitation = (r: StaffInviteRow): StaffInvitation => ({
  // Since invitation is stored inside staff, reuse staff.id as invitation id
  id: r.id,

  staff_id: r.id,
  email: r.email ?? "",

  token: r.invitation_token ?? "",
  status: (r.invitation_status ?? "pending") as any,

  // StaffInvitation type expects string (not null) so keep empty string if null
  expires_at: r.invitation_expires_at ?? "",
  accepted_at: r.invitation_accepted_at ?? "",

  // No separate invitation created_at exists; use updated_at as "invitation last created/updated"
  // Or if you prefer: r.created_at
  created_at: r.updated_at ?? r.created_at,
});

export const staffInvitationRepository = {
  async findByStaffId(staffId: string): Promise<StaffInvitation | null> {
    const { rows } = await pool.query<StaffInviteRow>(
      `
      SELECT
        id,
        email,
        invitation_token,
        invitation_status,
        invitation_expires_at,
        invitation_accepted_at,
        created_at,
        updated_at
      FROM staff
      WHERE id = $1
      LIMIT 1
      `,
      [staffId]
    );

    const row = rows[0];
    if (!row) return null;

    const hasInvite =
      !!row.invitation_token ||
      !!row.invitation_expires_at ||
      !!row.invitation_accepted_at ||
      !!row.invitation_status;

    if (!hasInvite) return null;

    return toInvitation(row);
  },

  async findByToken(token: string): Promise<StaffInvitation | null> {
    const { rows } = await pool.query<StaffInviteRow>(
      `
      SELECT
        id,
        email,
        invitation_token,
        invitation_status,
        invitation_expires_at,
        invitation_accepted_at,
        created_at,
        updated_at
      FROM staff
      WHERE invitation_token = $1
      LIMIT 1
      `,
      [token]
    );

    return rows[0] ? toInvitation(rows[0]) : null;
  },

  async create(staffId: string, email: string): Promise<StaffInvitation> {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 3600 * 1000).toISOString();

    const { rows } = await pool.query<StaffInviteRow>(
      `
      UPDATE staff
      SET
        email = COALESCE(email, $2),
        invitation_token = $3,
        invitation_status = 'pending',
        invitation_expires_at = $4,
        invitation_accepted_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        email,
        invitation_token,
        invitation_status,
        invitation_expires_at,
        invitation_accepted_at,
        created_at,
        updated_at
      `,
      [staffId, email, token, expiresAt]
    );

    if (!rows[0]) throw new Error("Staff not found to create invitation");

    return toInvitation(rows[0]);
  },

  async markExpired(staffId: string): Promise<void> {
    await pool.query(
      `
      UPDATE staff
      SET invitation_status = 'expired', updated_at = NOW()
      WHERE id = $1 AND invitation_status = 'pending'
      `,
      [staffId]
    );
  },

  async markCancelled(staffId: string): Promise<void> {
    await pool.query(
      `
      UPDATE staff
      SET invitation_status = 'cancelled', updated_at = NOW()
      WHERE id = $1 AND invitation_status IN ('pending','expired')
      `,
      [staffId]
    );
  },

  async markAccepted(token: string): Promise<StaffInvitation | null> {
    const { rows } = await pool.query<StaffInviteRow>(
      `
      UPDATE staff
      SET
        invitation_status = 'accepted',
        invitation_accepted_at = NOW(),
        invitation_token = NULL,
        invitation_expires_at = NULL,
        updated_at = NOW()
      WHERE invitation_token = $1
      RETURNING
        id,
        email,
        invitation_token,
        invitation_status,
        invitation_expires_at,
        invitation_accepted_at,
        created_at,
        updated_at
      `,
      [token]
    );

    return rows[0] ? toInvitation(rows[0]) : null;
  },
};