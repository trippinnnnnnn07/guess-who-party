import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import cors from 'cors'
import express from 'express'
import { Server } from 'socket.io'
import { createQuizRepository } from './quiz-repository.js'
import { mountQuizApi } from './quiz-api.js'
import { demoBank } from './quiz-demo.js'
import {
  quizSettings,
  startQuiz,
  advanceQuiz,
  answerQuiz,
  requestQuizHint,
  nextQuizQuestion,
  quizDeparture,
} from './odd-game.js'
import {
  assignCharacters,
  createRoomCode,
  isReady,
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
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
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
  const clientOrigin =
    options.clientOrigin ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
  const rooms = new Map()
  const turnTimers = new Map()
  const quizRepository = options.quizRepository ?? createQuizRepository()
  const demo =
    !quizRepository &&
    (options.quizDemo ??
      (process.env.QUIZ_DEMO_MODE === 'true' &&
        process.env.NODE_ENV !== 'production'))
      ? demoBank
      : null

  app.use(cors({ origin: clientOrigin }))
  mountQuizApi(app, quizRepository, demo)
  app.get('/health', (_request, response) => {
    response.json({ ok: true, rooms: rooms.size })
  })

  const clientDist = path.resolve(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  app.get('*', (request, response, next) => {
    if (
      request.path.startsWith('/socket.io') ||
      request.path.startsWith('/api/') ||
      request.path === '/health'
    )
      return next()
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
        io.to(player.socketId).emit(
          'roomState',
          publicRoomState(room, player.id),
        )
      }
    }
  }

  function scheduleTurn(room) {
    clearTimeout(turnTimers.get(room.code))
    turnTimers.delete(room.code)
    if (room.gameMode === 'odd') {
      if (room.status !== 'playing' || !room.quiz?.deadlineAt) return
      const timer = setTimeout(
        () => {
          turnTimers.delete(room.code)
          if (!rooms.has(room.code)) return
          if (advanceQuiz(room)) broadcastRoom(room)
          scheduleTurn(room)
        },
        Math.max(0, room.quiz.deadlineAt - Date.now()),
      )
      timer.unref()
      turnTimers.set(room.code, timer)
      return
    }
    if (
      room.status !== 'playing' ||
      !['turn', 'intermission'].includes(room.round?.phase)
    )
      return
    const timer = setTimeout(
      () => {
        turnTimers.delete(room.code)
        if (!rooms.has(room.code)) return
        if (advanceExpiredTurn(room)) broadcastRoom(room)
        scheduleTurn(room)
      },
      Math.max(0, room.round.deadlineAt - Date.now()),
    )
    timer.unref()
    turnTimers.set(room.code, timer)
  }

  function syncExpiredTurn(room) {
    if (
      room.gameMode === 'odd' ? advanceQuiz(room) : advanceExpiredTurn(room)
    ) {
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
      if (room.gameMode === 'odd') quizDeparture(room)
      else handleRoundDeparture(room, player.id)
      scheduleTurn(room)
      if (room.players.size === 0) {
        rooms.delete(room.code)
      } else if (room.hostId === player.id) {
        room.hostId =
          [...room.players.values()].find((item) => item.connected)?.id ??
          room.players.keys().next().value
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
      const totalRounds = payload?.totalRounds ?? 1
      if (
        !Number.isInteger(totalRounds) ||
        totalRounds < 1 ||
        totalRounds > 10
      ) {
        return reply(ack, {
          ok: false,
          error: 'เลือกจำนวนรอบตั้งแต่ 1 ถึง 10 รอบ',
        })
      }
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
        characters: Array(totalRounds).fill(null),
        assignedCharacter: null,
      }
      const room = {
        code,
        gameMode: 'classic',
        hostId: playerId,
        status: 'waiting',
        totalRounds,
        players: new Map([[playerId, player]]),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      }
      rooms.set(code, room)
      bindPlayer(socket, room, player)
      reply(ack, {
        ok: true,
        session: {
          roomCode: code,
          playerId,
          sessionToken: player.sessionToken,
        },
        state: publicRoomState(room, playerId),
      })
      broadcastRoom(room)
    })

    socket.on('joinRoom', async (payload, ack) => {
      const name = cleanName(payload?.name)
      const code = normalizeRoomCode(payload?.roomCode)
      if (!name) return reply(ack, { ok: false, error: 'กรุณาใส่ชื่อผู้เล่น' })

      const room = rooms.get(code)
      if (!room)
        return reply(ack, {
          ok: false,
          error: 'ไม่พบห้องนี้ กรุณาตรวจสอบรหัสอีกครั้ง',
        })
      if (room.status !== 'waiting' || room.starting) {
        return reply(ack, { ok: false, error: 'เกมในห้องนี้เริ่มไปแล้ว' })
      }

      let user
      if (room.gameMode === 'odd' && payload?.accessToken && quizRepository) {
        try {
          user = await quizRepository.identity(payload.accessToken)
        } catch {
          return reply(ack, {
            ok: false,
            error: 'กรุณาเข้าสู่ระบบ Google ใหม่',
          })
        }
        if (
          !socket.connected ||
          !rooms.has(code) ||
          room.status !== 'waiting' ||
          room.starting
        )
          return reply(ack, {
            ok: false,
            error: 'สถานะห้องเปลี่ยน กรุณาลองใหม่',
          })
      }

      removeSocketFromCurrentRoom(socket, true)
      const playerId = crypto.randomUUID()
      const player = {
        id: playerId,
        sessionToken: crypto.randomBytes(32).toString('hex'),
        name,
        connected: true,
        socketId: socket.id,
        characters: Array(room.totalRounds).fill(null),
        assignedCharacter: null,
      }
      room.players.set(playerId, player)
      player.userId = user?.id
      bindPlayer(socket, room, player)
      reply(ack, {
        ok: true,
        session: {
          roomCode: code,
          playerId,
          sessionToken: player.sessionToken,
        },
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
        session: {
          roomCode: code,
          playerId: player.id,
          sessionToken: player.sessionToken,
        },
        state: publicRoomState(room, player.id),
      })
      broadcastRoom(room)
    })

    socket.on('submitCharacter', (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player)
        return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.gameMode === 'odd')
        return reply(ack, {
          ok: false,
          error: 'โหมดนี้ไม่ต้องส่งตัวละครในห้อง',
        })
      if (room.status !== 'waiting')
        return reply(ack, { ok: false, error: 'เกมเริ่มแล้ว' })

      const roundIndex = payload?.roundIndex ?? 0
      if (
        !Number.isInteger(roundIndex) ||
        roundIndex < 0 ||
        roundIndex >= room.totalRounds
      ) {
        return reply(ack, { ok: false, error: 'หมายเลขรอบไม่ถูกต้อง' })
      }
      const validated = validateCharacter(payload)
      if (validated.error)
        return reply(ack, { ok: false, error: validated.error })

      player.characters[roundIndex] = validated.character
      room.lastActiveAt = Date.now()
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('startGame', (_payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player)
        return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.gameMode === 'odd')
        return reply(ack, {
          ok: false,
          error: 'กรุณาเริ่มเกมผ่านโหมดใครต่างจากเพื่อน',
        })
      if (room.hostId !== player.id)
        return reply(ack, {
          ok: false,
          error: 'เฉพาะโฮสต์เท่านั้นที่เริ่มเกมได้',
        })
      if (room.status !== 'waiting')
        return reply(ack, { ok: false, error: 'รอบนี้เริ่มไปแล้ว' })
      if (room.players.size < 2)
        return reply(ack, { ok: false, error: 'ต้องมีผู้เล่นอย่างน้อย 2 คน' })
      if ([...room.players.values()].some((item) => !item.connected)) {
        return reply(ack, {
          ok: false,
          error: 'รอให้ผู้เล่นทุกคนเชื่อมต่อก่อน',
        })
      }
      if (
        [...room.players.values()].some(
          (item) => !isReady(item, room.totalRounds),
        )
      ) {
        return reply(ack, {
          ok: false,
          error: 'รอให้ทุกคนส่งตัวละครครบทุกรอบก่อน',
        })
      }

      assignCharacters(room, Math.random, options.intermissionMs)
      startRound(room, Date.now(), options.turnDurationMs)
      scheduleTurn(room)
      room.lastActiveAt = Date.now()
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('resetGame', (_payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player)
        return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.hostId !== player.id)
        return reply(ack, { ok: false, error: 'เฉพาะโฮสต์เท่านั้น' })

      if (room.starting)
        return reply(ack, { ok: false, error: 'กำลังเตรียมโจทย์' })
      if (room.gameMode === 'odd') {
        room.quiz = null
        room.status = 'waiting'
      } else resetRound(room)
      scheduleTurn(room)
      room.lastActiveAt = Date.now()
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('requestAnswer', (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player)
        return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.gameMode === 'odd')
        return reply(ack, { ok: false, error: 'โหมดไม่ถูกต้อง' })
      syncExpiredTurn(room)
      const error = requestAnswer(room, player.id, payload?.turnId)
      if (error)
        return reply(ack, {
          ok: false,
          error,
          state: publicRoomState(room, player.id),
        })
      room.lastActiveAt = Date.now()
      scheduleTurn(room)
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    socket.on('castVote', (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player)
        return reply(ack, { ok: false, error: 'คุณไม่ได้อยู่ในห้อง' })
      if (room.gameMode === 'odd')
        return reply(ack, { ok: false, error: 'โหมดไม่ถูกต้อง' })
      const error = castVote(room, player.id, payload)
      if (error)
        return reply(ack, {
          ok: false,
          error,
          state: publicRoomState(room, player.id),
        })
      room.lastActiveAt = Date.now()
      scheduleTurn(room)
      reply(ack, { ok: true, state: publicRoomState(room, player.id) })
      broadcastRoom(room)
    })

    // Async quiz events serialize per socket; starting additionally locks the room.
    let quizBusy = false
    function quizEvent(name, handler) {
      socket.on(name, async (payload, ack) => {
        if (quizBusy)
          return reply(ack, {
            ok: false,
            error: 'กำลังดำเนินการ กรุณารอสักครู่',
          })
        quizBusy = true
        try {
          await handler(payload || {}, ack)
        } catch (error) {
          reply(ack, {
            ok: false,
            error:
              error.status || (error instanceof Error && !error.code)
                ? error.message
                : 'ดำเนินการไม่สำเร็จ',
          })
        } finally {
          quizBusy = false
        }
      })
    }
    quizEvent('quizCreate', async (payload, ack) => {
      if (!quizRepository && !demo)
        throw new Error('ยังไม่ได้เชื่อมต่อ Supabase กรุณาตั้งค่าฐานข้อมูลก่อน')
      const settings = quizSettings(payload.settings)
      const name = cleanName(payload.name)
      if (!name) throw new Error('กรุณาใส่ชื่อผู้เล่น')
      const user = payload.accessToken
        ? await quizRepository?.identity(payload.accessToken)
        : null
      if (!socket.connected) return
      removeSocketFromCurrentRoom(socket, true)
      const code = createRoomCode(rooms)
      const playerId = crypto.randomUUID()
      const player = {
        id: playerId,
        name,
        sessionToken: crypto.randomBytes(32).toString('hex'),
        userId: user?.id,
        connected: true,
        socketId: socket.id,
        characters: [],
      }
      const room = {
        code,
        gameMode: 'odd',
        demo: Boolean(demo),
        hostId: playerId,
        quizSettings: settings,
        totalRounds: 0,
        status: 'waiting',
        players: new Map([[playerId, player]]),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      }
      rooms.set(code, room)
      bindPlayer(socket, room, player)
      reply(ack, {
        ok: true,
        session: {
          roomCode: code,
          playerId,
          sessionToken: player.sessionToken,
        },
        state: publicRoomState(room, playerId),
      })
      broadcastRoom(room)
    })
    quizEvent('quizIdentity', async (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || !player || room.gameMode !== 'odd')
        throw new Error('ไม่พบห้องเกม')
      if (room.status !== 'waiting' || room.starting)
        throw new Error('เกมเริ่มแล้ว')
      const user = payload.accessToken
        ? await quizRepository?.identity(payload.accessToken)
        : null
      if (
        room.status !== 'waiting' ||
        room.starting ||
        roomForSocket(socket).player !== player
      )
        throw new Error('สถานะห้องเปลี่ยนแล้ว')
      player.userId = user?.id
      reply(ack, { ok: true })
    })
    quizEvent('quizStart', async (_payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || room.gameMode !== 'odd' || room.hostId !== player?.id)
        throw new Error('เฉพาะโฮสต์เท่านั้น')
      if (room.status !== 'waiting' || room.starting)
        throw new Error('เกมเริ่มแล้วหรือกำลังเตรียมโจทย์')
      if (
        room.players.size < 2 ||
        [...room.players.values()].some((p) => !p.connected)
      )
        throw new Error(
          'ต้องมีผู้เล่นออนไลน์อย่างน้อย 2 คน และทุกคนต้องเชื่อมต่อ',
        )
      room.starting = true
      const roster = [...room.players.keys()].join(',')
      try {
        const questions = await (quizRepository || demo).pick(
          room.quizSettings,
          [...room.players.values()].map((p) => p.userId).filter(Boolean),
        )
        if (
          !rooms.has(room.code) ||
          room.hostId !== player.id ||
          roster !== [...room.players.keys()].join(',') ||
          [...room.players.values()].some((p) => !p.connected)
        )
          throw new Error('ผู้เล่นในห้องเปลี่ยน กรุณาเริ่มใหม่')
        startQuiz(room, questions)
        scheduleTurn(room)
        reply(ack, { ok: true, state: publicRoomState(room, player.id) })
        broadcastRoom(room)
      } finally {
        room.starting = false
      }
    })
    for (const [event, action] of [
      ['quizAnswer', answerQuiz],
      ['quizHint', requestQuizHint],
    ]) {
      quizEvent(event, async (payload, ack) => {
        const { room, player } = roomForSocket(socket)
        if (!room || !player || room.gameMode !== 'odd')
          throw new Error('คุณไม่ได้อยู่ในห้องโหมดนี้')
        syncExpiredTurn(room)
        const error = action(room, player.id, payload)
        scheduleTurn(room)
        room.lastActiveAt = Date.now()
        reply(ack, {
          ok: !error,
          error,
          state: publicRoomState(room, player.id),
        })
        broadcastRoom(room)
      })
    }
    quizEvent('quizNext', async (payload, ack) => {
      const { room, player } = roomForSocket(socket)
      if (!room || room.gameMode !== 'odd' || room.hostId !== player?.id)
        throw new Error('เฉพาะโฮสต์เท่านั้น')
      const error = nextQuizQuestion(room, payload.questionToken)
      scheduleTurn(room)
      reply(ack, { ok: !error, error, state: publicRoomState(room, player.id) })
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

  const cleanupTimer = setInterval(
    () => {
      const expiry = Date.now() - 30 * 60 * 1000
      for (const [code, room] of rooms) {
        const hasConnectedPlayer = [...room.players.values()].some(
          (player) => player.connected,
        )
        if (!hasConnectedPlayer && room.lastActiveAt < expiry) {
          clearTimeout(turnTimers.get(code))
          turnTimers.delete(code)
          rooms.delete(code)
        }
      }
    },
    5 * 60 * 1000,
  )
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
