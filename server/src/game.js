import { INTERMISSION_MS, publicRoundState } from './round.js'
import { publicQuizRoom } from './odd-game.js'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normalizeRoomCode(value = '') {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function createRoomCode(existingCodes, length = 6) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = ''
    for (let i = 0; i < length; i += 1) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
    }
    if (!existingCodes.has(code)) return code
  }
  throw new Error('ไม่สามารถสร้างรหัสห้องได้ กรุณาลองใหม่')
}

export function createDerangement(values, random = Math.random) {
  if (values.length < 2) {
    throw new Error('ต้องมีผู้เล่นอย่างน้อย 2 คน')
  }

  const result = [...values]
  // Sattolo's algorithm creates a single cycle, so no item stays in place.
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * i)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function assignCharacters(room, random = Math.random, intermissionMs = INTERMISSION_MS) {
  const players = [...room.players.values()]
  const ownerIds = players.map((player) => player.id)
  room.match = {
    currentRound: 0, intermissionMs, results: [],
    scores: new Map(players.map(({ id, name }) => [id, { id, name, total: 0, rounds: Array(room.totalRounds).fill(null) }])),
    // Future answers stay exclusively on the server; each submitted slot is used once.
    assignments: Array.from({ length: room.totalRounds }, (_, roundIndex) => {
      const assignedOwnerIds = createDerangement(ownerIds, random)
      return new Map(players.map((player, index) => [player.id, {
        ...room.players.get(assignedOwnerIds[index]).characters[roundIndex],
      }]))
    }),
  }
}

export function isReady(player, totalRounds) {
  return Array.from({ length: totalRounds }, (_, index) => player.characters[index]).every(Boolean)
}

export function publicRoomState(room, viewerId) {
  if (room.gameMode === 'odd') return publicQuizRoom(room, viewerId)
  const viewer = room.players.get(viewerId)
  const standings = room.match ? [...room.match.scores.values()]
    .map((entry) => ({ ...entry, departed: !room.players.has(entry.id) }))
    .sort((a, b) => b.total - a.total) : []
  const revealAll = ['intermission', 'finished'].includes(room.round?.phase)

  return {
    code: room.code,
    status: room.status,
    totalRounds: room.totalRounds,
    standings,
    results: room.match?.results ?? [],
    winnerIds: room.status === 'finished' ? standings.filter((entry) => entry.total === standings[0]?.total).map((entry) => entry.id) : [],
    round: publicRoundState(room, viewerId),
    hostId: room.hostId,
    playerCount: room.players.size,
    allReady: [...room.players.values()].every((player) => isReady(player, room.totalRounds)),
    allConnected: [...room.players.values()].every((player) => player.connected),
    myCharacters: room.status === 'waiting' ? viewer?.characters ?? [] : [],
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === room.hostId,
      connected: player.connected,
      isReady: isReady(player, room.totalRounds),
      submittedCount: player.characters.filter(Boolean).length,
      score: room.match?.scores.get(player.id)?.total ?? 0,
      roundResult: room.round?.finishers.find((entry) => entry.id === player.id) ?? null,
      assignedCharacter:
        (room.status === 'playing' || room.status === 'finished') &&
        (player.id !== viewerId || revealAll || room.round?.finishers.some((entry) => entry.id === viewerId))
          ? player.assignedCharacter
          : null,
      isMe: player.id === viewerId,
    })),
  }
}
