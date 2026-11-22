import pool from "../../config/database";
import { SpotlightVideo, SpotlightVideoInput } from "./spotlight-video.types";

// pg returns a DATE as a Date at LOCAL midnight, so format it with local parts (toISOString would shift the day in timezones ahead of UTC).
function dateOnly(v: unknown): string {
    if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    return String(v).slice(0, 10);
}

function mapRow(row: any): SpotlightVideo {
    return {
        id: row.id,
        title: row.title,
        youtubeUrl: row.youtube_url,
        youtubeVideoId: row.youtube_video_id,
        description: row.description,
        isEnabled: row.is_enabled,
        showFloatingPlayer: row.show_floating_player,
        autoPlay: row.auto_play,
        playerSize: row.player_size,
        startDate: dateOnly(row.start_date),
        endDate: dateOnly(row.end_date),
        startTime: String(row.start_time).slice(0, 5),   // "09:00:00" -> "09:00"
        endTime: String(row.end_time).slice(0, 5),
        playbackDurationMinutes: row.playback_duration_minutes,
        playbackBehavior: row.playback_behavior,
        repeatSchedule: row.repeat_schedule,
        priority: row.priority,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

const COLUMNS = [
    "title", "youtube_url", "youtube_video_id", "description", "is_enabled", "show_floating_player", "auto_play", "player_size",
    "start_date", "end_date", "start_time", "end_time", "playback_duration_minutes", "playback_behavior", "repeat_schedule", "priority",
];

type Writable = SpotlightVideoInput & { youtubeVideoId: string };

const toValues = (v: Writable): unknown[] => [
    v.title, v.youtubeUrl, v.youtubeVideoId, v.description, v.isEnabled, v.showFloatingPlayer, v.autoPlay, v.playerSize,
    v.startDate, v.endDate, v.startTime, v.endTime, v.playbackDurationMinutes, v.playbackBehavior, v.repeatSchedule, v.priority,
];

export const spotlightVideoRepository = {
    /** Admin list: every video, newest first. */
    async listAll(): Promise<SpotlightVideo[]> {
        const { rows } = await pool.query(`SELECT * FROM spotlight_videos ORDER BY created_at DESC`);
        return rows.map(mapRow);
    },

    /** Salon-facing list: only videos that could ever show (enabled, floating player on, not already over). The one day of slack on end_date
     *  covers the gap between the server's date and a salon in a timezone ahead of it; the client does the exact check. */
    async listPlayable(): Promise<SpotlightVideo[]> {
        const { rows } = await pool.query(
            `SELECT * FROM spotlight_videos
              WHERE is_enabled = TRUE AND show_floating_player = TRUE AND end_date >= CURRENT_DATE - 1
              ORDER BY priority DESC, created_at DESC`,
        );
        return rows.map(mapRow);
    },

    async findById(id: string): Promise<SpotlightVideo | null> {
        const { rows } = await pool.query(`SELECT * FROM spotlight_videos WHERE id = $1`, [id]);
        return rows[0] ? mapRow(rows[0]) : null;
    },

    async create(v: Writable, createdBy: string): Promise<SpotlightVideo> {
        const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(",");
        const { rows } = await pool.query(
            `INSERT INTO spotlight_videos (${COLUMNS.join(",")}, created_by) VALUES (${placeholders}, $${COLUMNS.length + 1}) RETURNING *`,
            [...toValues(v), createdBy],
        );
        return mapRow(rows[0]);
    },

    /** Writes every column: the service merges the patch onto the stored row and validates the whole thing first. */
    async update(id: string, v: Writable): Promise<SpotlightVideo | null> {
        const sets = COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(", ");
        const { rows } = await pool.query(
            `UPDATE spotlight_videos SET ${sets}, updated_at = NOW() WHERE id = $${COLUMNS.length + 1} RETURNING *`,
            [...toValues(v), id],
        );
        return rows[0] ? mapRow(rows[0]) : null;
    },

    async remove(id: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM spotlight_videos WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
    },
};
