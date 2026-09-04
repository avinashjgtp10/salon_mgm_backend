import pool from "../../config/database";
import { SpotlightCreateBody, SpotlightFeature, SpotlightUpdateBody } from "./spotlight.types";

// Maps a `spotlight_features` DB row (snake_case) to the frontend-shaped
// SpotlightFeature (camelCase) — kept in one place so every read (list,
// getById, create/update's RETURNING) produces an identical shape.
function mapRow(row: any): SpotlightFeature {
    return {
        id: row.id,
        featureName: row.feature_name,
        module: row.module,
        moduleRoute: row.module_route,
        shortDescription: row.short_description,
        whatIsThis: row.what_is_this,
        howItWorks: row.how_it_works,
        benefits: row.benefits,
        images: row.images ?? [],
        videoDataUrl: row.video_url,
        releaseDate: row.release_date instanceof Date ? row.release_date.toISOString().slice(0, 10) : row.release_date,
        targetAudience: row.target_audience ?? ["all"],
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export const spotlightRepository = {
    // includeUnpublished: superadmin's manage list needs draft/archived rows
    // too; the salon-facing list must never receive them (enforced by the
    // service layer always passing false for that caller, not by trusting
    // this flag alone — see spotlight.service.ts).
    async list(includeUnpublished: boolean): Promise<SpotlightFeature[]> {
        const where = includeUnpublished ? "" : `WHERE status = 'published'`;
        const { rows } = await pool.query(
            `SELECT * FROM spotlight_features ${where} ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC`
        );
        return rows.map(mapRow);
    },

    async findById(id: string): Promise<SpotlightFeature | null> {
        const { rows } = await pool.query(`SELECT * FROM spotlight_features WHERE id = $1`, [id]);
        return rows[0] ? mapRow(rows[0]) : null;
    },

    async create(body: SpotlightCreateBody, createdBy: string): Promise<SpotlightFeature> {
        const { rows } = await pool.query(
            `INSERT INTO spotlight_features (
                feature_name, module, module_route, short_description, what_is_this,
                how_it_works, benefits, images, video_url, release_date,
                target_audience, status, published_at, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING *`,
            [
                body.featureName, body.module, body.moduleRoute ?? null, body.shortDescription, body.whatIsThis ?? "",
                body.howItWorks ?? "", body.benefits ?? "", JSON.stringify(body.images ?? []), body.videoDataUrl ?? null,
                body.releaseDate || new Date().toISOString().slice(0, 10),
                JSON.stringify(body.targetAudience?.length ? body.targetAudience : ["all"]),
                body.status ?? "draft",
                body.status === "published" ? new Date() : null,
                createdBy,
            ]
        );
        return mapRow(rows[0]);
    },

    // Partial update — only columns present in `body` are touched. Publishing
    // (status transitioning draft/archived -> published) is handled by the
    // service layer calling markPublished() separately, so published_at is
    // never silently overwritten by an unrelated field edit here.
    async update(id: string, body: SpotlightUpdateBody): Promise<SpotlightFeature | null> {
        const sets: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        const push = (col: string, val: unknown) => { sets.push(`${col} = $${idx++}`); values.push(val); };

        if (body.featureName !== undefined) push("feature_name", body.featureName);
        if (body.module !== undefined) push("module", body.module);
        if (body.moduleRoute !== undefined) push("module_route", body.moduleRoute ?? null);
        if (body.shortDescription !== undefined) push("short_description", body.shortDescription);
        if (body.whatIsThis !== undefined) push("what_is_this", body.whatIsThis);
        if (body.howItWorks !== undefined) push("how_it_works", body.howItWorks);
        if (body.benefits !== undefined) push("benefits", body.benefits);
        if (body.images !== undefined) push("images", JSON.stringify(body.images));
        if (body.videoDataUrl !== undefined) push("video_url", body.videoDataUrl ?? null);
        if (body.releaseDate !== undefined) push("release_date", body.releaseDate);
        if (body.targetAudience !== undefined) push("target_audience", JSON.stringify(body.targetAudience?.length ? body.targetAudience : ["all"]));
        // status here covers draft<->archived and archived->draft etc. — the
        // "first ever publish" transition (which also stamps published_at)
        // goes through markPublished() instead so this generic path can't
        // accidentally set status='published' without the timestamp.
        if (body.status !== undefined && body.status !== "published") push("status", body.status);

        if (!sets.length) return this.findById(id);

        sets.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await pool.query(
            `UPDATE spotlight_features SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
            values
        );
        return rows[0] ? mapRow(rows[0]) : null;
    },

    // Transitions to 'published' and stamps published_at, but ONLY on the
    // first-ever publish (published_at IS NULL) — re-publishing an already-
    // published feature (e.g. editing it) must never re-stamp published_at,
    // since that timestamp is what gates the one-time notify-every-salon
    // broadcast (see spotlight.service.ts#publish). Returns null if the
    // feature was already published (so the caller knows not to broadcast
    // again), or the updated row on a genuine first publish.
    async markPublished(id: string): Promise<SpotlightFeature | null> {
        const { rows } = await pool.query(
            `UPDATE spotlight_features
                SET status = 'published', published_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND published_at IS NULL
              RETURNING *`,
            [id]
        );
        if (rows[0]) return mapRow(rows[0]);

        // Already published at least once before (published_at already set) —
        // just re-activate status if it had been archived, without touching
        // published_at or re-triggering the notify-every-salon broadcast.
        // Return value is null either way: it signals "not a first-time
        // publish" to the caller regardless of whether this re-activation ran.
        await pool.query(
            `UPDATE spotlight_features
                SET status = 'published', updated_at = NOW()
              WHERE id = $1 AND status != 'published'`,
            [id]
        );
        return null;
    },

    async delete(id: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM spotlight_features WHERE id = $1`, [id]);
        return (rowCount ?? 0) > 0;
    },

    // ── Per-user explored state ─────────────────────────────────────────────

    async getExploredIds(userId: string): Promise<string[]> {
        const { rows } = await pool.query(
            `SELECT feature_id FROM spotlight_feature_reads WHERE user_id = $1`,
            [userId]
        );
        return rows.map((r) => r.feature_id);
    },

    async markExplored(featureId: string, userId: string): Promise<void> {
        await pool.query(
            `INSERT INTO spotlight_feature_reads (feature_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (feature_id, user_id) DO NOTHING`,
            [featureId, userId]
        );
    },
};
