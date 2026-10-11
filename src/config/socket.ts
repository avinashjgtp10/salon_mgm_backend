import { Server as HttpServer } from 'http'
import { Server as SocketIOServer, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import logger from './logger'
import pool from './database'
import { isSessionActive } from '../modules/auth/session.util'
import { isStaffAccount } from '../modules/notifications/staffNotificationScope'

let io: SocketIOServer | null = null

type SocketUser = { userId: string; role: string; salonId: string | null; mobileStaff: boolean }

// Rooms:
//   salon:<id>        owners/managers: every salon event with full payloads
//   salon:<id>:staff  mobile staff: payload-free invalidation events only
//   user:<userId>     one account: notifications addressed to that user
export const salonRoom = (salonId: string) => `salon:${salonId}`
export const salonStaffRoom = (salonId: string) => `salon:${salonId}:staff`
export const userRoom = (userId: string) => `user:${userId}`
export const mobileStaffUserRoom = (userId: string) => `mobile-staff-user:${userId}`

function getAllowedOrigins(): string | string[] | boolean {
  if (process.env.CORS_ALLOW_ALL_ORIGINS === 'true') return true

  const origins = (process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim().replace(/\/$/, ''))
    .filter(Boolean)

  return origins.length === 1 ? origins[0] : origins
}

// Same token and session rules as authMiddleware, applied once per connection.
async function authenticate(socket: Socket): Promise<SocketUser | null> {
  const token = socket.handshake.auth?.token
  const secret = process.env.JWT_ACCESS_SECRET
  if (typeof token !== 'string' || !token || !secret) return null
  let decoded: any
  try { decoded = jwt.verify(token, secret) } catch { return null }
  if (!decoded?.userId) return null
  if (decoded.sid) {
    let active = true
    try { active = await isSessionActive(String(decoded.sid)) } catch { active = true /* fail open like authMiddleware */ }
    if (!active) return null
  }
  const role = String(decoded.role ?? '')
  return {
    userId: String(decoded.userId),
    role,
    salonId: decoded.salonId ? String(decoded.salonId) : null,
    // Web staff keep the salon room their dashboard permissions already rely on;
    // the mobile staff app only ever shows the staff member's own data.
    mobileStaff: isStaffAccount(role) && socket.handshake.auth?.client === 'mobile',
  }
}

async function canJoinSalon(user: SocketUser, salonId: string): Promise<boolean> {
  if (user.role === 'super_admin' || user.salonId === salonId) return true
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM salons WHERE id::text = $1 AND owner_id::text = $2)
         OR EXISTS (SELECT 1 FROM branch_owner_salons WHERE salon_id::text = $1 AND branch_owner_id::text = $2)
         OR EXISTS (SELECT 1 FROM staff WHERE salon_id::text = $1 AND user_id::text = $2 AND is_active = true) AS ok`,
    [salonId, user.userId],
  )
  return rows[0]?.ok === true
}

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin:      getAllowedOrigins(),
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  // The mobile app connects with its access token and is checked here. The web
  // dashboard still connects without one, so token-less sockets keep the
  // original unchecked join_salon behaviour until the web app sends a token too.
  io.use(async (socket, next) => {
    if (!socket.handshake.auth?.token) { socket.data.user = null; return next() }
    const user = await authenticate(socket).catch(() => null)
    if (!user) return next(new Error('UNAUTHORIZED'))
    socket.data.user = user
    return next()
  })

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUser | null
    logger.info(`🔌 Socket connected: ${socket.id}`, { userId: user?.userId, role: user?.role })
    if (user) socket.join(userRoom(user.userId))
    if (user?.mobileStaff) socket.join(mobileStaffUserRoom(user.userId))

    // Client joins their salon room so we can target events per salon
    socket.on('join_salon', async (salonId: unknown, ack?: unknown) => {
      const reply = (ok: boolean) => { if (typeof ack === 'function') ack({ ok }) }
      if (typeof salonId !== 'string' || !salonId) return reply(false)
      if (!user) {
        socket.join(salonRoom(salonId))
        logger.info(`📥 Socket ${socket.id} joined salon:${salonId} (no token)`)
        return reply(true)
      }
      let allowed = false
      try { allowed = await canJoinSalon(user, salonId) } catch (err: any) {
        logger.warn('Socket salon access check failed', { socketId: socket.id, salonId, message: err?.message })
      }
      if (!allowed) {
        logger.warn(`⛔ Socket ${socket.id} refused salon:${salonId}`, { userId: user.userId, role: user.role })
        return reply(false)
      }
      // One salon at a time: switching branches leaves the previous salon's rooms.
      for (const room of socket.rooms) if (room.startsWith('salon:')) socket.leave(room)
      const room = user.mobileStaff ? salonStaffRoom(salonId) : salonRoom(salonId)
      socket.join(room)
      logger.info(`📥 Socket ${socket.id} joined ${room}`)
      reply(true)
    })

    socket.on('salon:leave', () => {
      for (const room of socket.rooms) if (room.startsWith('salon:')) socket.leave(room)
    })

    socket.on('disconnect', () => {
      logger.info(`🔌 Socket disconnected: ${socket.id}`)
    })
  })

  return io
}

// Use this anywhere in the backend to emit events to a salon room
export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io not initialized — call initSocket() first')
  return io
}
