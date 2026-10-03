import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import cors from 'cors'
import express from 'express'
import { Server } from 'socket.io'
import {
  assignCharacters,
  createRoomCode,
  normalizeRoomCode,
  publicRoomState,
} from './game.js'
import {
  advanceExpiredTurn,
  castVote,
  handleRoundDeparture,
  requestAnswer,
  resetRound,
  startRound,
} from './round.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAX_IMAGE_DATA_LENGTH = 5_000_000
const IMAGE_DATA_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,/i

function cleanName(value, maxLength = 32) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength)
}

function validateCharacter(payload) {
  const name = cleanName(payload?.name, 50)
  const imageDataUrl = String(payload?.imageDataUrl ?? '')

  if (!name) return { error: 'กรุณาใส่ชื่อตัวละคร' }
  if (!IMAGE_DATA_PATTERN.test(imageDataUrl)) {
    return { error: 'กรุณาเลือกรูป PNG, JPG, WEBP หรือ GIF' }
  }
  if (imageDataUrl.length > MAX_IMAGE_DATA_LENGTH) {
    return { error: 'รูปมีขนาดใหญ่เกินไป กรุณาเลือกรูปไม่เกิน 3 MB' }
  }
  return { character: { name, imageDataUrl } }
}

export function createGameServer(options = {}) {
  const app = express()
  const httpServer = http.createServer(app)
  const clientOrigin = options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
  const rooms = new Map()
  const turnTimers = new Map()

  app.use(cors({ origin: clientOrigin }))
  app.get('/health', (_request, response) => {
    response.json({ ok: true, rooms: rooms.size })
  })

  const clientDist = path.resolve(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/socket.io') || request.path === '/health') return next()
    response.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) next()
    })
  })

  const io = new Server(httpServer, {
    cors: { origin: clientOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 6_000_000,
  })

  function reply(ack, payload) {
    if (typeof ack === 'function') ack(payload)
  }

  function roomForSocket(socket) {
    const room = rooms.get(socket.data.roomCode)
    const player = room?.players.get(socket.data.playerId)
    return { room, player }
  }

  function broadcastRoom(room) {
    for (const player of room.players.values()) {
      if (player.socketId) {
        io.to(player.socketId).emit('roomState', publicRoomState(room, player.id))
      }
    }
  }

  function scheduleTurn(room) {
    clearTimeout(turnTimers.get(room.code))
    turnTimers.delete(room.code)
    if (room.status !== 'playing' || room.round?.phase !== 'turn') return
    const timer = setTimeout(() => {
      turnTimers.delete(room.code)
      if (!rooms.has(room.code)) return
      if (advanceExpiredTurn(room)) broadcastRoom(room)
      scheduleTurn(room)
    }, Math.max(0, room.round.deadlineAt - Date.now()))
    timer.unref()
    turnTimers.set(room.code, timer)
  }

  function syncExpiredTurn(room) {
    if (advanceExpiredTurn(room)) {
      scheduleTurn(room)
      broadcastRoom(room)
    }
  }

  function bindPlayer(socket, room, player) {
    if (player.socketId && player.socketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(player.socketId)
      previousSocket?.leave(room.code)
      previousSocket?.emit('sessionReplaced')
      if (previousSocket) {
        previousSocket.data.roomCode = undefined
        previousSocket.data.playerId = undefined
      }
    }

    socket.join(room.code)
    socket.data.roomCode = room.code
    socket.data.playerId = player.id
    player.socketId = socket.id
    player.connected = true
    room.lastActiveAt = Date.now()
  }

  function removeSocketFromCurrentRoom(socket, removePlayer = false) {
    const { room, player } = roomForSocket(socket)
    if (!room || !player) return

    if (removePlayer) {
      room.players.delete(player.id)
      handleRoundDeparture(room, player.id)
      scheduleTurn(room)
      if (room.players.size === 0) {
        rooms.delete(room.code)
      } else if (room.hostId === player.id) {
        room.hostId = [...room.players.values()].find((item) => item.connected)?.id ?? room.players.keys().next().value
      }
    } else if (player.socketId === socket.id) {
      player.connected = false
      player.socketId = null
      room.lastActiveAt = Date.now()
    }

    socket.leave(room.code)
    socket.data.roomCode = undefined
    socket.data.playerId = undefined
    if (rooms.has(room.code)) broadcastRoom(room)
  }

  io.on('connection', (socket) => {
    socket.on('createRoom', (payload, ack) => {
      const name = cleanName(payload?.name)
      if (!name) return reply(ack, { ok: false, error: 'กรุณาใส่ชื่อผู้เล่น' })

      removeSocketFromCurrentRoom(socket, true)
      const code = createRoomCode(rooms)
      const playerId = crypto.randomUUID()
      const player = {
        id: playerId,
        sessionToken: crypto.randomBytes(32).toString('hex'),
        name,
        connected: true,
        socketId: socket.id,
        character: null,
        assignedCharacter: null,
      }
      const room = {
        code,
        hostId: playerId,
        status: 'waiting',
        players: new Map([[playerId, player]]),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      }
      rooms.set(code, room)
      bindPlayer(socket, room, player)
      reply(ack, {
        ok: true,
        session: { roomCode: code, playerId, sessionToken: player.sessionToken },
        state: publicRoomState(room, playerId),
      })
      broadcastRoom(room)
    })

    socket.on('joinRoom', (payload, ack) => {
      const name = cleanName(payload?.name)
      const code = normalizeRoomCode(payload?.roomCode)
      if (!name) return reply(ack, { ok: false, error: 'กรุณาใส่ชื่อผู้เล่น' })

      const room = rooms.get(code)
      if (!room) return reply(ack, { ok: false, error: 'ไม่พบห้องนี้ กรุณาตรวจสอบรหัสอีกครั้ง' })
      if (room.status !== 'waiting') {
        return reply(ack, { ok: false, error: 'เกมในห้องนี้เริ่มไปแล้ว' })
      }

      removeSocketFromCurrentRoom(socket, true)
      const playerId = crypto.randomUUID()
      const player = {
        id: playerId,
        sessionToken: crypto.randomBytes(32).toString('hex'),
        name,
        connected: true,
        socketId: socket.id,
        character: null,
        assignedCharacter: null,
      }
      room.players.set(playerId, player)
      bindPlayer(socket, room, player)
      reply(ack, {
        ok: true,
        session: { roomCode: code, playerId, sessionToken: player.sessionToken },
        state: publicRoomState(room, playerId),
      })
      broadcastRoom(room)
    })

    socket.on('rejoinRoom', (payload, ack) => {
      const code = normalizeRoomCode(payload?.roomCode)
      const room = rooms.get(code)
      const player = room?.players.get(payload?.playerId)
      if (!room || !player || payload?.sessionToken !== player.sessionToken) {
        return reply(ack, { ok: false, error: 'ห้องเดิมหมดอายุแล้ว' })
      }

      const isAlreadyBound =
        socket.data.roomCode === room.code && socket.data.playerId === player.id
      if (!isAlreadyBound) removeSocketFromCurrentRoom(socket, true)
      bindPlayer(socket, room, player)
      syncExpiredTurn(room)
      reply(ack, {
        ok: true,
        session: { roomCode: code, playerId: player.id, sessionToken: player.sessionToken },
        state: publicRoomState(room, player.id),
      })
      broadcastRoom(room)
    })

    socket.on('submitCharacter', (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player) return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.status !== 'waiting') return reply(ack, { ok: false, error: 'เกมเริ่มแล้ว' })

      const validated = validateCharacter(payload)
      if (validated.error) return reply(ack, { ok: false, error: validated.error })

      player.character = validated.character
      room.lastActiveAt = Date.now()
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('startGame', (_payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player) return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.hostId !== player.id) return reply(ack, { ok: false, error: 'เฉพาะโฮสต์เท่านั้นที่เริ่มเกมได้' })
      if (room.status !== 'waiting') return reply(ack, { ok: false, error: 'รอบนี้เริ่มไปแล้ว' })
      if (room.players.size < 2) return reply(ack, { ok: false, error: 'ต้องมีผู้เล่นอย่างน้อย 2 คน' })
      if ([...room.players.values()].some((item) => !item.connected)) {
        return reply(ack, { ok: false, error: 'รอให้ผู้เล่นทุกคนเชื่อมต่อก่อน' })
      }
      if ([...room.players.values()].some((item) => !item.character)) {
        return reply(ack, { ok: false, error: 'รอให้ทุกคนส่งตัวละครก่อน' })
      }

      assignCharacters(room)
      startRound(room, Date.now(), options.turnDurationMs)
      scheduleTurn(room)
      room.lastActiveAt = Date.now()
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('resetGame', (_payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player) return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.hostId !== player.id) return reply(ack, { ok: false, error: 'เฉพาะโฮสต์เท่านั้น' })

      resetRound(room)
      scheduleTurn(room)
      room.lastActiveAt = Date.now()
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('requestAnswer', (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player) return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      syncExpiredTurn(room)
      const error = requestAnswer(room, player.id, payload?.turnId)
      if (error) return reply(ack, { ok: false, error, state: publicRoomState(room, player.id) })
      room.lastActiveAt = Date.now()
      scheduleTurn(room)
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('castVote', (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player) return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      const error = castVote(room, player.id, payload)
      if (error) return reply(ack, { ok: false, error, state: publicRoomState(room, player.id) })
      room.lastActiveAt = Date.now()
      scheduleTurn(room)
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('leaveRoom', (_payload, ack) => {
      removeSocketFromCurrentRoom(socket, true)
      reply(ack, { ok: true })
    })

    socket.on('disconnect', () => {
      removeSocketFromCurrentRoom(socket, false)
    })
  })

  const cleanupTimer = setInterval(() => {
    const expiry = Date.now() - 30 * 60 * 1000
    for (const [code, room] of rooms) {
      const hasConnectedPlayer = [...room.players.values()].some((player) => player.connected)
      if (!hasConnectedPlayer && room.lastActiveAt < expiry) {
        clearTimeout(turnTimers.get(code))
        turnTimers.delete(code)
        rooms.delete(code)
      }
    }
  }, 5 * 60 * 1000)
  cleanupTimer.unref()

  async function close() {
    clearInterval(cleanupTimer)
    for (const timer of turnTimers.values()) clearTimeout(timer)
    turnTimers.clear()
    await new Promise((resolve) => io.close(resolve))
    if (httpServer.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }

  return { app, httpServer, io, rooms, close }
}
