import { z } from 'zod'

export const sendReplySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(4096, 'Message too long (max 4096 chars)'),
})

// Sends one APPROVED template to a single conversation. `variables` is keyed by
// slot number ("1", "2", …) — same shape campaign contacts use.
export const sendTemplateSchema = z.object({
  templateId: z.string().trim().min(1, 'templateId is required'),
  variables:  z.record(z.string(), z.string().max(1024)).optional().default({}),
  couponCode: z.string().trim().max(64).optional(),
  expiresAt:  z.string().trim().max(64).optional(),   // ISO date-time or epoch ms
})