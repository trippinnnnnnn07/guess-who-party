import { randomUUID } from 'node:crypto'

export const TURN_DURATION_MS = 15_000
export const INTERMISSION_MS = 6_000

export function startRound(room, now = Date.now(), durationMs = TURN_DURATION_MS) {
  room.status = 'playing'
  const order = [...room.players.keys()]
  // Rotate the starting seat between rounds, retaining the joining order.
  const offset = room.match.currentRound % order.length
  order.push(...order.splice(0, offset))
  for (const player of room.players.values()) {
    player.assignedCharacter = room.match.assignments[room.match.currentRound].get(player.id)
  }
  room.round = {
    order, turnIndex: 0, turnNumber: 1, turnId: randomUUID(), durationMs,
    deadlineAt: now + durationMs, remainingMs: durationMs,
    phase: 'turn', vote: null, notice: null, finishers: [], playerCount: order.length,
  }
}

export function resetRound(room) {
  room.status = 'waiting'
  room.round = null
  room.match = null
  for (const player of room.players.values()) {
    player.characters = Array(room.totalRounds).fill(null)
    player.assignedCharacter = null
  }
}

export function activePlayerId(room) {
  return room.round?.order[room.round.turnIndex] ?? null
}

function remainingPlayers(room) {
  return room.round.order.filter((id) => room.players.has(id) && !room.round.finishers.some((entry) => entry.id === id))
}

function award(room, id, solved) {
  const round = room.round
  const rank = solved ? round.finishers.length + 1 : round.playerCount
  const points = solved ? round.playerCount - rank : 0
  const entry = room.match.scores.get(id)
  entry.total += points
  entry.rounds[room.match.currentRound] = points
  round.finishers.push({ id, name: entry.name, rank, points, solved })
}

function finishRound(room, now) {
  const round = room.round
  const remaining = remainingPlayers(room)
  if (remaining.length > 1) return false
  if (remaining.length === 1) award(room, remaining[0], false)
  for (const entry of room.match.scores.values()) {
    entry.rounds[room.match.currentRound] ??= 0
  }
  room.match.results.push({ number: room.match.currentRound + 1, finishers: [...round.finishers] })
  round.vote = null
  round.notice = null
  if (room.match.currentRound + 1 >= room.totalRounds) {
    room.status = 'finished'
    round.phase = 'finished'
    round.deadlineAt = null
    round.remainingMs = 0
  } else {
    round.phase = 'intermission'
    round.remainingMs = room.match.intermissionMs
    round.deadlineAt = now + round.remainingMs
  }
  return true
}

export function advanceTurn(room, now = Date.now()) {
  const round = room.round
  if (room.status !== 'playing' || !round || round.phase === 'intermission') return false
  if (room.players.size < 2) {
    resetRound(room)
    return true
  }
  if (finishRound(room, now)) return true
  const remaining = remainingPlayers(room)
  do {
    round.turnIndex = (round.turnIndex + 1) % round.order.length
  } while (!remaining.includes(round.order[round.turnIndex]))
  round.turnNumber += 1
  round.turnId = randomUUID()
  round.phase = 'turn'
  round.deadlineAt = now + round.durationMs
  round.remainingMs = round.durationMs
  round.vote = null
  round.notice = null
  return true
}

export function advanceExpiredTurn(room, now = Date.now()) {
  if (room.status !== 'playing' || !['turn', 'intermission'].includes(room.round?.phase) || now < room.round.deadlineAt) return false
  if (room.round.phase === 'intermission') {
    const durationMs = room.round.durationMs
    room.match.currentRound += 1
    startRound(room, now, durationMs)
    return true
  }
  return advanceTurn(room, now)
}

function newBallot(room, attempt = 1) {
  return {
    id: randomUUID(), candidateId: activePlayerId(room),
    eligibleIds: [...room.players.keys()].filter((id) => id !== activePlayerId(room)),
    votes: new Map(), attempt,
  }
}

export function requestAnswer(room, playerId, turnId, now = Date.now()) {
  const round = room.round
  if (room.status !== 'playing' || round?.phase !== 'turn') return 'ตอนนี้ยังตอบไม่ได้'
  if (turnId !== round.turnId || now >= round.deadlineAt) return 'ตานี้หมดเวลาแล้ว'
  if (playerId !== activePlayerId(room)) return 'รอให้ถึงตาของคุณก่อนนะ'
  round.remainingMs = Math.max(0, round.deadlineAt - now)
  round.deadlineAt = null
  round.phase = 'voting'
  round.notice = null
  round.vote = newBallot(room)
  return null
}

export function castVote(room, playerId, payload, now = Date.now()) {
  const round = room.round
  const ballot = round?.vote
  if (room.status !== 'playing' || round?.phase !== 'voting' || !ballot) return 'ไม่มีคำตอบที่รอโหวต'
  if (payload?.voteId !== ballot.id) return 'การโหวตรอบเดิมจบแล้ว กรุณาเลือกรอบใหม่'
  if (!ballot.eligibleIds.includes(playerId)) return 'ผู้ตอบโหวตคำตอบตัวเองไม่ได้'
  if (typeof payload?.correct !== 'boolean') return 'กรุณาเลือกถูกหรือผิด'
  if (ballot.votes.has(playerId)) return 'คุณโหวตรอบนี้แล้ว'
  ballot.votes.set(playerId, payload.correct)
  if (ballot.votes.size < ballot.eligibleIds.length) return null

  const answers = [...ballot.votes.values()]
  const candidate = room.players.get(ballot.candidateId)
  if (answers.every(Boolean)) {
    award(room, candidate.id, true)
    const result = round.finishers.at(-1)
    advanceTurn(room, now)
    round.notice = { type: 'correct', message: `${candidate.name} ทายถูกเป็นอันดับ ${result.rank} ได้ ${result.points} คะแนน` }
  } else if (answers.every((answer) => !answer)) {
    round.phase = 'turn'
    round.deadlineAt = now + round.remainingMs
    round.vote = null
    round.notice = { type: 'wrong', message: `ทุกคนเห็นตรงกันว่า ${candidate.name} ตอบผิด เล่นต่อด้วยเวลาที่เหลือได้เลย` }
  } else {
    round.vote = newBallot(room, ballot.attempt + 1)
    round.notice = { type: 'inconclusive', message: 'ผลไม่เป็นเอกฉันท์ ให้ทุกคนเลือกใหม่ว่าทายถูกหรือผิด' }
  }
  return null
}

// Temporary disconnect retains the seat and vote; explicit leave removes it.
export function handleRoundDeparture(room, playerId, now = Date.now()) {
  if (room.status !== 'playing' || !room.round) return
  if (room.players.size < 2) return resetRound(room)
  if (room.round.phase === 'intermission') return
  if (finishRound(room, now)) return
  if (playerId === activePlayerId(room)) {
    advanceTurn(room, now)
    room.round.notice = { type: 'cancelled', message: 'ผู้เล่นเจ้าของตาออกจากห้อง เปลี่ยนไปยังผู้เล่นถัดไปแล้ว' }
  } else if (room.round.phase === 'voting') {
    room.round.vote = newBallot(room, room.round.vote.attempt + 1)
    room.round.notice = { type: 'inconclusive', message: 'มีผู้เล่นออกจากห้อง ให้ผู้เล่นที่เหลือทุกคนโหวตใหม่' }
  }
}

export function publicRoundState(room, viewerId, now = Date.now()) {
  const round = room.round
  if (!round) return null
  return {
    number: room.match.currentRound + 1,
    phase: round.phase,
    order: round.order.filter((id) => room.players.has(id)),
    activePlayerId: ['turn', 'voting'].includes(round.phase) ? activePlayerId(room) : null,
    turnNumber: round.turnNumber, turnId: round.turnId,
    durationMs: round.phase === 'intermission' ? room.match.intermissionMs : round.durationMs,
    deadlineAt: round.deadlineAt,
    remainingMs: round.deadlineAt === null ? round.remainingMs : Math.max(0, round.deadlineAt - now),
    finishers: round.finishers,
    notice: round.notice,
    vote: round.vote ? {
      id: round.vote.id, candidateId: round.vote.candidateId, attempt: round.vote.attempt,
      eligibleIds: round.vote.eligibleIds, votedIds: [...round.vote.votes.keys()],
      myVote: round.vote.votes.get(viewerId) ?? null,
    } : null,
  }
}
