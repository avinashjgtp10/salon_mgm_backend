import bcrypt from 'bcrypt'
import { AppError } from '../../../../middleware/error.middleware'
import { usersRepository } from './users.repository'
import { CreateUserBody, UpdateUserBody } from './users.types'

export const usersService = {

  async getAll(salonId: string) {
    return usersRepository.findBySalonId(salonId)
  },

  async create(salonId: string, body: CreateUserBody) {
    const password_hash = await bcrypt.hash(body.password, 10)
    return usersRepository.create(salonId, {
      first_name:    body.first_name,
      last_name:     body.last_name,
      email:         body.email,
      password_hash,
      role:          body.role,
    })
  },

  async update(id: string, salonId: string, body: UpdateUserBody) {
    const exists = await usersRepository.findById(id, salonId)
    if (!exists) throw new AppError(404, 'User not found', 'NOT_FOUND')

    const updates: Record<string, any> = {}
    if (body.first_name) updates.first_name = body.first_name
    if (body.last_name)  updates.last_name  = body.last_name
    if (body.email)      updates.email      = body.email
    if (body.role)       updates.role       = body.role
    if (body.password)   updates.password_hash = await bcrypt.hash(body.password, 10)

    return usersRepository.update(id, salonId, updates)
  },

  async remove(id: string, salonId: string) {
    const deleted = await usersRepository.delete(id, salonId)
    if (!deleted) throw new AppError(404, 'User not found', 'NOT_FOUND')
    return { message: 'User removed successfully' }
  },
}
