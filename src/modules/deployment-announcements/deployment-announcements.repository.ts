import pool from "../../config/database";
import { DeploymentAnnouncement, CreateDeploymentAnnouncementBody } from "./deployment-announcements.types";

export const deploymentAnnouncementsRepository = {
  async create(body: CreateDeploymentAnnouncementBody, createdBy: string | null): Promise<DeploymentAnnouncement> {
    const { rows } = await pool.query(
      `INSERT INTO deployment_announcements (message, start_time, end_time, created_by)
       VALUES ($1, COALESCE($2::timestamptz, NOW()), $3, $4)
       RETURNING *`,
      [body.message, body.start_time ?? null, body.end_time, createdBy],
    );
    return rows[0];
  },

  // The currently-active announcement, if any — "active" means both
  // status='active' (not manually stopped) AND still inside its window
  // (start_time <= now < end_time). A window that has simply elapsed is
  // never written back to status='stopped'; that distinction only matters
  // for the Super Admin's own history view, not for what clients should see.
  async getActive(): Promise<DeploymentAnnouncement | null> {
    const { rows } = await pool.query(
      `SELECT * FROM deployment_announcements
       WHERE status = 'active' AND start_time <= NOW() AND end_time > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    return rows[0] || null;
  },

  async stop(id: string): Promise<DeploymentAnnouncement | null> {
    const { rows } = await pool.query(
      `UPDATE deployment_announcements SET status = 'stopped', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id],
    );
    return rows[0] || null;
  },

  async listRecent(limit = 20): Promise<DeploymentAnnouncement[]> {
    const { rows } = await pool.query(
      `SELECT * FROM deployment_announcements ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  },
};
