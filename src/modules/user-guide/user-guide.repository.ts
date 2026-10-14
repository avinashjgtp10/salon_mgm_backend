import pool from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

export const guideRepository = {
  async get(userId: string) {
    const { rows } = await pool.query('SELECT guide_progress FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new AppError(404, 'User not found', 'NOT_FOUND');
    return rows[0].guide_progress;
  },
  async save(userId: string, feature: string, status: 'completed' | 'skipped') {
    // Atomic JSON merge preserves future feature keys; repeated writes are
    // idempotent and the existing user primary key prevents duplicate records.
    const { rows } = await pool.query(
      `UPDATE users SET guide_progress = guide_progress || jsonb_build_object($2::text, jsonb_build_object('status', $3::text))
       WHERE id = $1 RETURNING guide_progress`, [userId, feature, status],
    );
    if (!rows[0]) throw new AppError(404, 'User not found', 'NOT_FOUND');
    return rows[0].guide_progress;
  },
};
