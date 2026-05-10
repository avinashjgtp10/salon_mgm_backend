import pool from '../../../../config/database'
import { WATemplate, CreateTemplateBody } from './templates.types'

export const templatesRepository = {

  async findAll(salonId: string): Promise<WATemplate[]> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_templates WHERE salon_id = $1 ORDER BY created_at DESC`,
      [salonId]
    )
    return rows
  },

  async findById(id: string, salonId: string): Promise<WATemplate | null> {
    const { rows } = await pool.query(
      `SELECT * FROM wa_templates WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    )
    return rows[0] || null
  },

  async create(
    salonId: string,
    body: CreateTemplateBody & { meta_template_id?: string | null; header_media_id?: string | null; status?: string }
  ): Promise<WATemplate> {
    const { rows } = await pool.query(`
      INSERT INTO wa_templates
        (salon_id, name, category, language, header_type, header_text,
         body_text, footer_text, buttons, meta_template_id, header_media_id, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
      RETURNING *
    `, [
      salonId,
      body.name,
      body.category,
      body.language,
      body.header_type,
      body.header_text      ?? null,
      body.body_text,
      body.footer_text      ?? null,
      JSON.stringify(body.buttons ?? []),
      body.meta_template_id ?? null,
      body.header_media_id  ?? null,
      body.status           ?? 'PENDING',
    ])
    return rows[0]
  },

  async updateStatus(
    id:               string,
    status:           string,
    metaTemplateId?:  string | null,
    rejectionReason?: string | null
  ): Promise<WATemplate> {
    const { rows } = await pool.query(`
      UPDATE wa_templates SET
        status           = $2::text,
        meta_template_id = COALESCE($3, meta_template_id),
        rejection_reason = $4,
        approved_at      = CASE WHEN $2::text = 'APPROVED' THEN NOW() ELSE approved_at END,
        updated_at       = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, status, metaTemplateId ?? null, rejectionReason ?? null])
    return rows[0]
  },

  async updateMediaId(id: string, salonId: string, mediaId: string): Promise<WATemplate | null> {
    const { rows } = await pool.query(
      `UPDATE wa_templates
       SET header_media_id = $1, updated_at = NOW()
       WHERE id = $2 AND salon_id = $3
       RETURNING *`,
      [mediaId, id, salonId]
    )
    return rows[0] || null
  },

  async delete(id: string, salonId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM wa_templates WHERE id = $1 AND salon_id = $2`,
      [id, salonId]
    )
    return (result.rowCount ?? 0) > 0
  },
}