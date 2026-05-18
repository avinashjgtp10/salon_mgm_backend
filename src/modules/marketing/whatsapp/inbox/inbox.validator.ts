import { z } from 'zod'

export const sendReplySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(4096, 'Message too long (max 4096 chars)'),
})