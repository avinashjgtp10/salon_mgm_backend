import pool from '../../config/database';
import {
  MarketplaceListing,
  MarketplaceBooking,
  MarketplaceReview,
  CreateListingBody,
  UpdateListingBody,
  CreateBookingBody,
  CreateReviewBody,
} from './marketplace.types';

export const marketplaceRepository = {

  // ── Listings ──────────────────────────────────────────────────────────────

  async findListingBySalonId(salonId: string): Promise<MarketplaceListing | null> {
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_listings WHERE salon_id = $1`,
      [salonId]
    );
    return rows[0] || null;
  },


  async findListingByUserId(userId: string): Promise<MarketplaceListing | null> {
    const via = await pool.query(
      `SELECT ml.* FROM marketplace_listings ml
       JOIN salons s ON s.id = ml.salon_id
       WHERE s.owner_id = $1 LIMIT 1`,
      [userId]
    );
    if (via.rows.length) return via.rows[0];
    const direct = await pool.query(
      `SELECT * FROM marketplace_listings WHERE salon_id = $1 LIMIT 1`,
      [userId]
    );
    return direct.rows[0] || null;
  },

  async ensureSalonExists(userId: string, businessName: string): Promise<string> {
    const existing = await pool.query(
      `SELECT id FROM salons WHERE owner_id = $1 LIMIT 1`, [userId]
    );
    if (existing.rows.length) return existing.rows[0].id;
    const created = await pool.query(
      `INSERT INTO salons (owner_id, business_name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId, businessName || 'My Salon', 'salon-' + userId.slice(0, 8)]
    );
    return created.rows[0]?.id ?? userId;
  },

  async findListingById(id: string): Promise<MarketplaceListing | null> {
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_listings WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async listPublished(filters: {
    city?: string;
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<MarketplaceListing[]> {
    const conditions: string[] = [`is_published = true`, `status = 'approved'`];
    const values: any[] = [];
    let idx = 1;

    if (filters.city) {
      conditions.push(`LOWER(city) = LOWER($${idx})`);
      values.push(filters.city); idx++;
    }
    if (filters.category) {
      conditions.push(`LOWER(category) = LOWER($${idx})`);
      values.push(filters.category); idx++;
    }
    if (filters.search) {
      conditions.push(`(LOWER(display_name) LIKE LOWER($${idx}) OR LOWER(description) LIKE LOWER($${idx}))`);
      values.push(`%${filters.search}%`); idx++;
    }

    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const { rows } = await pool.query(
      `SELECT * FROM marketplace_listings
       WHERE ${conditions.join(' AND ')}
       ORDER BY avg_rating DESC, created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset]
    );
    return rows;
  },

  async listAll(filters: { status?: string; city?: string }): Promise<MarketplaceListing[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters.status) {
      conditions.push(`status = $${idx}`);
      values.push(filters.status); idx++;
    }
    if (filters.city) {
      conditions.push(`LOWER(city) = LOWER($${idx})`);
      values.push(filters.city); idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_listings ${where} ORDER BY created_at DESC`,
      values
    );
    return rows;
  },

  async createListing(salonId: string, data: CreateListingBody): Promise<MarketplaceListing> {
    const { rows } = await pool.query(
      `INSERT INTO marketplace_listings (
        salon_id, display_name, description, phone, email,
        city, address, latitude, longitude, category,
        tags, amenities, highlights, working_hours,
        status, is_published
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
        'approved', false
      ) RETURNING *`,
      [
        salonId,
        data.display_name,
        data.description ?? null,
        data.phone ?? null,
        data.email ?? null,
        data.city ?? null,
        data.address ?? null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.category ?? null,
        JSON.stringify(data.tags ?? []),
        JSON.stringify(data.amenities ?? []),
        JSON.stringify(data.highlights ?? []),
        data.working_hours ? JSON.stringify(data.working_hours) : null,
      ]
    );
    return rows[0];
  },

  async updateListing(id: string, patch: UpdateListingBody): Promise<MarketplaceListing> {
    const JSONB_FIELDS = new Set(['tags', 'amenities', 'highlights', 'working_hours']);
    const keys = Object.keys(patch) as (keyof UpdateListingBody)[];

    if (keys.length === 0) {
      const { rows } = await pool.query(`SELECT * FROM marketplace_listings WHERE id = $1`, [id]);
      return rows[0];
    }

    const setParts: string[] = [];
    const values: any[] = [];

    keys.forEach(k => {
      const idx = values.length + 1;
      if (JSONB_FIELDS.has(k as string)) {
        setParts.push(`${String(k)} = $${idx}::jsonb`);
        values.push(JSON.stringify((patch as any)[k]));
      } else {
        setParts.push(`${String(k)} = $${idx}`);
        values.push((patch as any)[k]);
      }
    });

    setParts.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE marketplace_listings SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async updateStatus(id: string, status: string): Promise<MarketplaceListing> {
    const { rows } = await pool.query(
      `UPDATE marketplace_listings SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return rows[0];
  },

  async setPublished(id: string, published: boolean): Promise<MarketplaceListing> {
    const { rows } = await pool.query(
      `UPDATE marketplace_listings SET is_published = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, published]
    );
    return rows[0];
  },

  async addImage(id: string, imageUrl: string): Promise<MarketplaceListing> {
    const { rows } = await pool.query(
      `UPDATE marketplace_listings
       SET images = images || $2::jsonb, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify([imageUrl])]
    );
    return rows[0];
  },

  async setCoverImage(id: string, imageUrl: string): Promise<MarketplaceListing> {
    const { rows } = await pool.query(
      `UPDATE marketplace_listings SET cover_image = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, imageUrl]
    );
    return rows[0];
  },

  async removeImage(id: string, imageUrl: string): Promise<MarketplaceListing> {
    const { rows } = await pool.query(
      `UPDATE marketplace_listings
       SET images = (
         SELECT jsonb_agg(img) FROM jsonb_array_elements_text(images) AS img
         WHERE img != $2
       ),
       updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, imageUrl]
    );
    return rows[0];
  },

  // ── Bookings ──────────────────────────────────────────────────────────────

  async createBooking(salonId: string, data: CreateBookingBody): Promise<MarketplaceBooking> {
    const { rows } = await pool.query(
      `INSERT INTO marketplace_bookings (
        listing_id, salon_id, customer_name, customer_phone, customer_email,
        service_name, staff_name, booking_date, booking_time,
        duration_minutes, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
      RETURNING *`,
      [
        data.listing_id,
        salonId,
        data.customer_name,
        data.customer_phone,
        data.customer_email ?? null,
        data.service_name,
        data.staff_name ?? null,
        data.booking_date,
        data.booking_time,
        data.duration_minutes ?? 60,
        data.notes ?? null,
      ]
    );
    return rows[0];
  },

  async listBookingsByListing(listingId: string): Promise<MarketplaceBooking[]> {
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_bookings WHERE listing_id = $1 ORDER BY booking_date DESC, booking_time DESC`,
      [listingId]
    );
    return rows;
  },

  async listAllBookings(filters: { status?: string }): Promise<MarketplaceBooking[]> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (filters.status) {
      conditions.push(`status = $1`);
      values.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_bookings ${where} ORDER BY created_at DESC`,
      values
    );
    return rows;
  },

  async updateBookingStatus(id: string, status: string): Promise<MarketplaceBooking> {
    const { rows } = await pool.query(
      `UPDATE marketplace_bookings SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return rows[0];
  },

  // ── Reviews ───────────────────────────────────────────────────────────────

  async createReview(data: CreateReviewBody): Promise<MarketplaceReview> {
    const { rows } = await pool.query(
      `INSERT INTO marketplace_reviews (listing_id, customer_phone, customer_name, rating, comment)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.listing_id, data.customer_phone, data.customer_name ?? null, data.rating, data.comment ?? null]
    );
    // update avg_rating on listing
    await pool.query(
      `UPDATE marketplace_listings SET
        avg_rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM marketplace_reviews WHERE listing_id = $1),
        total_reviews = (SELECT COUNT(*) FROM marketplace_reviews WHERE listing_id = $1),
        updated_at = NOW()
       WHERE id = $1`,
      [data.listing_id]
    );
    return rows[0];
  },

  async listReviewsByListing(listingId: string): Promise<MarketplaceReview[]> {
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_reviews WHERE listing_id = $1 ORDER BY created_at DESC`,
      [listingId]
    );
    return rows;
  },

  async checkEmailExists(email: string): Promise<{ exists: boolean; role: string | null }> {
    const { rows } = await pool.query(
      `SELECT role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]
    );
    return rows.length > 0 ? { exists: true, role: rows[0].role } : { exists: false, role: null };
  },

  async getServicesByListingId(listingId: string): Promise<any[]> {
    const listing = await pool.query(
      `SELECT salon_id FROM marketplace_listings WHERE id = $1`, [listingId]
    );
    if (!listing.rows[0]) return [];
    const { rows } = await pool.query(
      `SELECT * FROM services WHERE salon_id = $1 AND is_active = true`, [listing.rows[0].salon_id]
    );
    return rows;
  },

  async getStaffByListingId(listingId: string): Promise<any[]> {
    const listing = await pool.query(
      `SELECT salon_id FROM marketplace_listings WHERE id = $1`, [listingId]
    );
    if (!listing.rows[0]) return [];
    const { rows } = await pool.query(
      `SELECT * FROM staff WHERE salon_id = $1 AND is_active = true`, [listing.rows[0].salon_id]
    );
    return rows;
  },

  async getBookedSlotsForDate(listingId: string, date: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT booking_time FROM marketplace_bookings
       WHERE listing_id = $1 AND booking_date = $2 AND status != 'cancelled'`,
      [listingId, date]
    );
    return rows.map((r: any) => r.booking_time);
  },

  async getBookingsByPhone(customerPhone: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT mb.*, ml.display_name AS salon_name
       FROM marketplace_bookings mb
       JOIN marketplace_listings ml ON ml.id = mb.listing_id
       WHERE mb.customer_phone = $1
       ORDER BY mb.booking_date DESC`,
      [customerPhone]
    );
    return rows;
  },

  async getWishlist(userId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT listing_id FROM marketplace_wishlist WHERE user_id = $1`, [userId]
    );
    return rows.map((r: any) => r.listing_id);
  },

  async addToWishlist(userId: string, listingId: string): Promise<void> {
    await pool.query(
      `INSERT INTO marketplace_wishlist (user_id, listing_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, listingId]
    );
  },

  async removeFromWishlist(userId: string, listingId: string): Promise<void> {
    await pool.query(
      `DELETE FROM marketplace_wishlist WHERE user_id = $1 AND listing_id = $2`,
      [userId, listingId]
    );
  },

  async getNotifications(userId: string): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT * FROM marketplace_notifications WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  },

  async markNotificationRead(id: string, userId: string): Promise<void> {
    await pool.query(
      `UPDATE marketplace_notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    await pool.query(
      `UPDATE marketplace_notifications SET is_read = true WHERE user_id = $1`,
      [userId]
    );
  },

};