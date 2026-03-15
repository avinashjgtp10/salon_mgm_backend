"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketplaceFeaturesRepo = exports.marketplaceImagesRepo = exports.marketplaceWorkingHoursRepo = exports.marketplaceLocationRepo = exports.marketplaceProfileRepo = void 0;
const database_1 = __importDefault(require("../../config/database"));
// ─── Profile ──────────────────────────────────────────────────────────────────
exports.marketplaceProfileRepo = {
    async findBySalonId(salonId) {
        const { rows } = await database_1.default.query(`SELECT * FROM marketplace_profiles WHERE salon_id = $1`, [salonId]);
        return rows[0] || null;
    },
    async upsertEssentials(salonId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO marketplace_profiles
         (salon_id, display_name, business_phone, business_phone_country_code, business_email)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (salon_id) DO UPDATE SET
         display_name                = EXCLUDED.display_name,
         business_phone              = EXCLUDED.business_phone,
         business_phone_country_code = EXCLUDED.business_phone_country_code,
         business_email              = EXCLUDED.business_email,
         updated_at                  = NOW()
       RETURNING *`, [
            salonId, data.display_name,
            data.business_phone ?? null,
            data.business_phone_country_code ?? null,
            data.business_email ?? null,
        ]);
        return rows[0];
    },
    async upsertAbout(salonId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO marketplace_profiles (salon_id, display_name, venue_description)
       VALUES ($1, $2, $3)
       ON CONFLICT (salon_id) DO UPDATE SET
         venue_description = EXCLUDED.venue_description,
         updated_at        = NOW()
       RETURNING *`, [salonId, data.venue_description, data.venue_description]);
        return rows[0];
    },
    async setPublished(salonId, published) {
        const { rows } = await database_1.default.query(`UPDATE marketplace_profiles SET is_published = $1, updated_at = NOW()
       WHERE salon_id = $2 RETURNING *`, [published, salonId]);
        return rows[0] || null;
    },
};
// ─── Location ─────────────────────────────────────────────────────────────────
exports.marketplaceLocationRepo = {
    async findByProfileId(profileId) {
        const { rows } = await database_1.default.query(`SELECT * FROM marketplace_locations WHERE profile_id = $1`, [profileId]);
        return rows[0] || null;
    },
    async upsert(profileId, data) {
        const { rows } = await database_1.default.query(`INSERT INTO marketplace_locations
         (profile_id, address_line, city, state, country, postal_code, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (profile_id) DO UPDATE SET
         address_line = EXCLUDED.address_line,
         city         = EXCLUDED.city,
         state        = EXCLUDED.state,
         country      = EXCLUDED.country,
         postal_code  = EXCLUDED.postal_code,
         latitude     = EXCLUDED.latitude,
         longitude    = EXCLUDED.longitude,
         updated_at   = NOW()
       RETURNING *`, [
            profileId,
            data.address_line,
            data.city ?? null,
            data.state ?? null,
            data.country ?? null,
            data.postal_code ?? null,
            data.latitude ?? null,
            data.longitude ?? null,
        ]);
        return rows[0];
    },
};
// ─── Working Hours ────────────────────────────────────────────────────────────
exports.marketplaceWorkingHoursRepo = {
    async findByProfileId(profileId) {
        const { rows } = await database_1.default.query(`SELECT * FROM marketplace_working_hours
       WHERE profile_id = $1 ORDER BY day_of_week, slot_index`, [profileId]);
        return rows;
    },
    async upsertBulk(profileId, body) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            const dayNums = body.days.map((d) => d.day_of_week);
            await client.query(`DELETE FROM marketplace_working_hours
         WHERE profile_id = $1 AND day_of_week = ANY($2::int[])`, [profileId, dayNums]);
            const results = [];
            for (const day of body.days) {
                if (!day.is_open) {
                    const { rows } = await client.query(`INSERT INTO marketplace_working_hours
               (profile_id, day_of_week, is_open, open_time, close_time, slot_index)
             VALUES ($1,$2,false,NULL,NULL,0) RETURNING *`, [profileId, day.day_of_week]);
                    results.push(rows[0]);
                }
                else {
                    for (let i = 0; i < day.slots.length; i++) {
                        const { rows } = await client.query(`INSERT INTO marketplace_working_hours
                 (profile_id, day_of_week, is_open, open_time, close_time, slot_index)
               VALUES ($1,$2,true,$3,$4,$5) RETURNING *`, [profileId, day.day_of_week, day.slots[i].open_time, day.slots[i].close_time, i]);
                        results.push(rows[0]);
                    }
                }
            }
            await client.query("COMMIT");
            return results;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
};
// ─── Images ───────────────────────────────────────────────────────────────────
exports.marketplaceImagesRepo = {
    async findByProfileId(profileId) {
        const { rows } = await database_1.default.query(`SELECT * FROM marketplace_images
       WHERE profile_id = $1 ORDER BY sort_order, created_at`, [profileId]);
        return rows;
    },
    async findById(id, profileId) {
        const { rows } = await database_1.default.query(`SELECT * FROM marketplace_images WHERE id = $1 AND profile_id = $2`, [id, profileId]);
        return rows[0] || null;
    },
    async count(profileId) {
        const { rows } = await database_1.default.query(`SELECT COUNT(*)::int AS total FROM marketplace_images WHERE profile_id = $1`, [profileId]);
        return rows[0].total;
    },
    async add(profileId, data) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            // If marking as cover, unset existing cover
            if (data.is_cover) {
                await client.query(`UPDATE marketplace_images SET is_cover = false WHERE profile_id = $1`, [profileId]);
            }
            // Get next sort_order
            const { rows: countRows } = await client.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM marketplace_images WHERE profile_id = $1`, [profileId]);
            const sortOrder = countRows[0].next_order;
            const { rows } = await client.query(`INSERT INTO marketplace_images (profile_id, image_url, is_cover, sort_order)
         VALUES ($1,$2,$3,$4) RETURNING *`, [profileId, data.image_url, data.is_cover ?? false, sortOrder]);
            await client.query("COMMIT");
            return rows[0];
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
    async setCover(id, profileId) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            await client.query(`UPDATE marketplace_images SET is_cover = false WHERE profile_id = $1`, [profileId]);
            const { rows } = await client.query(`UPDATE marketplace_images SET is_cover = true, updated_at = NOW()
         WHERE id = $1 AND profile_id = $2 RETURNING *`, [id, profileId]);
            await client.query("COMMIT");
            return rows[0] || null;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
    async reorder(profileId, data) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            for (let i = 0; i < data.image_ids.length; i++) {
                await client.query(`UPDATE marketplace_images SET sort_order = $1, updated_at = NOW()
           WHERE id = $2 AND profile_id = $3`, [i, data.image_ids[i], profileId]);
            }
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
    async delete(id, profileId) {
        const { rowCount } = await database_1.default.query(`DELETE FROM marketplace_images WHERE id = $1 AND profile_id = $2`, [id, profileId]);
        return (rowCount ?? 0) > 0;
    },
};
// ─── Features ─────────────────────────────────────────────────────────────────
exports.marketplaceFeaturesRepo = {
    async findByProfileId(profileId) {
        const { rows } = await database_1.default.query(`SELECT * FROM marketplace_features
       WHERE profile_id = $1 ORDER BY feature_type, feature_key`, [profileId]);
        return rows;
    },
    async upsert(profileId, data) {
        const client = await database_1.default.connect();
        try {
            await client.query("BEGIN");
            const typesToReplace = [];
            if (data.amenities !== undefined)
                typesToReplace.push("amenity");
            if (data.highlights !== undefined)
                typesToReplace.push("highlight");
            if (data.values !== undefined)
                typesToReplace.push("value");
            if (typesToReplace.length > 0) {
                await client.query(`DELETE FROM marketplace_features
           WHERE profile_id = $1 AND feature_type = ANY($2::text[])`, [profileId, typesToReplace]);
            }
            const toInsert = [
                ...(data.amenities ?? []).map((k) => ({ type: "amenity", key: k })),
                ...(data.highlights ?? []).map((k) => ({ type: "highlight", key: k })),
                ...(data.values ?? []).map((k) => ({ type: "value", key: k })),
            ];
            const results = [];
            for (const item of toInsert) {
                const { rows } = await client.query(`INSERT INTO marketplace_features (profile_id, feature_type, feature_key)
           VALUES ($1,$2,$3) RETURNING *`, [profileId, item.type, item.key]);
                results.push(rows[0]);
            }
            await client.query("COMMIT");
            return results;
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    },
};
//# sourceMappingURL=marketplace.repository.js.map