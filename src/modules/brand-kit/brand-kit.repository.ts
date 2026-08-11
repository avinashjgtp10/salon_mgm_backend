import pool from '../../config/database';

export interface BrandKitRow {
  salon_id: string;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  text_color: string | null;
  heading_font: string | null;
  body_font: string | null;
  logo_url: string | null;
  instagram: string | null;
  facebook: string | null;
  whatsapp_number: string | null;
  tagline: string | null;
  extras: Record<string, unknown>;
}

/** What the designer actually consumes: the kit merged with the salon record. */
export interface ResolvedBrandKit extends Omit<BrandKitRow, 'salon_id'> {
  salon_name: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
}

export const brandKitRepository = {
  /**
   * Returns the kit merged with the salon's own fields, seeded with sensible
   * defaults when no row exists yet — so the designer never has to handle a
   * missing kit, and a salon that has never opened this screen still gets its
   * name, phone and address in designs.
   *
   * The logo falls back through: brand kit → salons → marketplace profile.
   * marketplace_profiles is last because it's the one with a working uploader,
   * so it's the most likely to actually hold something today.
   */
  async resolve(salonId: string): Promise<ResolvedBrandKit> {
    const { rows } = await pool.query(
      `SELECT
         b.primary_color, b.secondary_color, b.accent_color, b.text_color,
         b.heading_font, b.body_font,
         COALESCE(b.logo_url, s.logo_url, mp.logo_url) AS logo_url,
         b.instagram, b.facebook, b.whatsapp_number, b.tagline,
         COALESCE(b.extras, '{}'::jsonb) AS extras,
         s.business_name AS salon_name,
         s.phone, s.website_url AS website,
         NULLIF(CONCAT_WS(', ', s.address, s.city, s.state, s.pincode), '') AS address
       FROM salons s
       LEFT JOIN salon_brand_kits b ON b.salon_id = s.id
       LEFT JOIN marketplace_profiles mp ON mp.salon_id = s.id
       WHERE s.id = $1
       LIMIT 1`,
      [salonId],
    );
    const r = rows[0] ?? {};
    return {
      primary_color: r.primary_color ?? '#4f46e5',
      secondary_color: r.secondary_color ?? '#101828',
      accent_color: r.accent_color ?? '#c9a227',
      text_color: r.text_color ?? '#111827',
      heading_font: r.heading_font ?? "'Playfair Display', Georgia, serif",
      body_font: r.body_font ?? 'Inter, sans-serif',
      logo_url: r.logo_url ?? null,
      instagram: r.instagram ?? null,
      facebook: r.facebook ?? null,
      whatsapp_number: r.whatsapp_number ?? null,
      tagline: r.tagline ?? null,
      extras: r.extras ?? {},
      salon_name: r.salon_name ?? null,
      phone: r.phone ?? null,
      website: r.website ?? null,
      address: r.address ?? null,
    };
  },
};
