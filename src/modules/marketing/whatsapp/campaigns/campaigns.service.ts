import pool from '../../../../config/database'
import { AppError } from '../../../../middleware/error.middleware'
import { campaignsRepository } from './campaigns.repository'
import { campaignQueue } from '../queue/campaign.queue'
import { CreateCampaignBody } from './campaigns.types'

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

export const campaignsService = {

  async getAll(salonId: string) {
    return campaignsRepository.findAll(salonId)
  },

  async getById(id: string, salonId: string) {
    const c = await campaignsRepository.findById(id, salonId)
    if (!c) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')
    return c
  },

  async create(salonId: string, body: CreateCampaignBody) {
    const { rows: tmpl } = await pool.query(
      `SELECT id FROM wa_templates
       WHERE id = $1 AND salon_id = $2 AND status = 'APPROVED'`,
      [body.template_id, salonId]
    )
    if (!tmpl[0]) throw new AppError(400, 'Template not found or not approved', 'TEMPLATE_NOT_APPROVED')

    const batchSize = body.batch_size ?? 50
    const client    = await pool.connect()

    try {
      await client.query('BEGIN')
      const campaignId = await campaignsRepository.create(
        salonId, body.template_id, body.name, batchSize, body.contacts.length
      )
      await campaignsRepository.bulkInsertContacts(campaignId, body.contacts)
      await client.query('COMMIT')

      const ids     = await campaignsRepository.getContactIds(campaignId)
      const batches = chunk(ids, batchSize)

      for (let i = 0; i < batches.length; i++) {
        await campaignQueue.add('send-batch', {
          campaignId, salonId,
          batchIndex: i,
          contactIds: batches[i],
        }, { delay: i * 2000 })
      }

      return campaignsRepository.findById(campaignId, salonId)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  },

  async pause(id: string, salonId: string) {
    await this.getById(id, salonId)
    return campaignsRepository.updateStatus(id, 'PAUSED')
  },

  async resume(id: string, salonId: string) {
    const campaign = await this.getById(id, salonId)
    const pending  = await campaignsRepository.getPendingContactIds(id)

    if (pending.length > 0) {
      const batches = chunk(pending, campaign.batch_size)
      for (let i = 0; i < batches.length; i++) {
        await campaignQueue.add('send-batch', {
          campaignId: id, salonId,
          batchIndex: i,
          contactIds: batches[i],
        }, { delay: i * 2000 })
      }
    }

    return campaignsRepository.updateStatus(id, 'SENDING')
  },

  async getContacts(id: string, salonId: string, status?: string) {
    await this.getById(id, salonId)
    return campaignsRepository.getContacts(id, status)
  },

  async getReport(id: string, salonId: string, type: string) {
    await this.getById(id, salonId)
    return campaignsRepository.getReport(id, type)
  },
}
