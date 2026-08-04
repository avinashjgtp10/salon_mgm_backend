import pool from "../../config/database";
import { ClientNote, CreateClientNoteBody, UpdateClientNoteBody } from "./client-notes.types";

// Self-migrating on server start — same convention as
// client-memberships.repository.ts's ensureTable(), wired into app.ts.
export async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_notes (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id   UUID        NOT NULL,
      client_id  UUID        NOT NULL,
      staff_id   UUID,
      staff_name VARCHAR(255),
      note       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_notes_client ON client_notes(client_id)`);
}

export const clientNotesRepository = {
  async listByClientId(clientId: string): Promise<ClientNote[]> {
    const { rows } = await pool.query(
      `SELECT * FROM client_notes WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId],
    );
    return rows;
  },

  async findById(id: string, clientId: string): Promise<ClientNote | null> {
    const { rows } = await pool.query(
      `SELECT * FROM client_notes WHERE id = $1 AND client_id = $2`,
      [id, clientId],
    );
    return rows[0] || null;
  },

  async create(
    salonId: string, clientId: string, staffId: string | null, data: CreateClientNoteBody,
  ): Promise<ClientNote> {
    const { rows } = await pool.query(
      `INSERT INTO client_notes (salon_id, client_id, staff_id, staff_name, note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [salonId, clientId, staffId, data.staff_name ?? null, data.note],
    );
    return rows[0];
  },

  async update(id: string, clientId: string, patch: UpdateClientNoteBody): Promise<ClientNote | null> {
    const { rows } = await pool.query(
      `UPDATE client_notes SET note = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3 RETURNING *`,
      [patch.note, id, clientId],
    );
    return rows[0] || null;
  },

  async delete(id: string, clientId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      `DELETE FROM client_notes WHERE id = $1 AND client_id = $2`,
      [id, clientId],
    );
    return (rowCount ?? 0) > 0;
  },
};
