import { Server as HttpServer } from 'http'
import { Server as SocketIOServer, Socket } from 'socket.io'
import logger from './logger'

let io: SocketIOServer | null = null

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL ?? 'http://localhost:5173',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  io.on('connection', (socket: Socket) => {
    logger.info(`🔌 Socket connected: ${socket.id}`)

    // Client joins their salon room so we can target events per salon
    socket.on('join_salon', (salonId: string) => {
      socket.join(`salon:${salonId}`)
      logger.info(`📥 Socket ${socket.id} joined salon:${salonId}`)
    })

    socket.on('disconnect', () => {
      logger.info(`🔌 Socket disconnected: ${socket.id}`)
    })
  })

  return io
}

// Use this anywhere in the backend to emit events
export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io not initialized — call initSocket() first')
  return io
}