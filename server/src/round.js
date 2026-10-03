import { randomUUID } from 'node:crypto'

export const TURN_DURATION_MS = 15_000

export function startRound(room, now = Date.now(), durationMs = TURN_DURATION_MS) {
  room.status = 'playing'
  room.round = {
    order: [...room.players.keys()],
    turnIndex: 0,
    turnNumber: 1,
    turnId: randomUUID(),
    durationMs,
    deadlineAt: now + durationMs,
    remainingMs: durationMs,
    phase: 'turn',
    vote: null,
    winner: null,
    notice: null,
  }
}

export function resetRound(room) {
  room.status = 'waiting'
  room.round = null
  for (const player of room.players.values()) {
    player.character = null
    player.assignedCharacter = null
  }
}

export function activePlayerId(room) {
  return room.round?.order[room.round.turnIndex] ?? null
}

export function advanceTurn(room, now = Date.now()) {
  const round = room.round
  if (room.status !== 'playing' || !round) return false
  if (room.players.size < 2) {
    resetRound(room)
    return true
  }
  do {
    round.turnIndex = (round.turnIndex + 1) % round.order.length
  } while (!room.players.has(round.order[round.turnIndex]))
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
  if (room.status === 'playing' && room.round?.phase === 'turn' && now >= room.round.deadlineAt) {
    return advanceTurn(room, now)
  }
  return false
}

function newBallot(room, attempt = 1) {
  return {
    id: randomUUID(),
    candidateId: activePlayerId(room),
    eligibleIds: [...room.players.keys()].filter((id) => id !== activePlayerId(room)),
    votes: new Map(),
    attempt,
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
    room.status = 'finished'
    round.phase = 'finished'
    round.deadlineAt = null
    round.winner = {
      id: candidate.id,
      name: candidate.name,
      assignedCharacter: { ...candidate.assignedCharacter },
    }
    round.vote = null
    round.notice = null
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

// Call after an explicit leave. A temporary disconnect keeps the same vote and seat.
export function handleRoundDeparture(room, playerId, now = Date.now()) {
  if (room.status !== 'playing' || !room.round) return
  if (room.players.size < 2) {
    resetRound(room)
    return
  }
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
    phase: round.phase,
    order: round.order.filter((id) => room.players.has(id)),
    activePlayerId: activePlayerId(room),
    turnNumber: round.turnNumber,
    turnId: round.turnId,
    durationMs: round.durationMs,
    deadlineAt: round.deadlineAt,
    remainingMs: round.phase === 'turn' ? Math.max(0, round.deadlineAt - now) : round.remainingMs,
    winner: round.winner,
    notice: round.notice,
    vote: round.vote ? {
      id: round.vote.id,
      candidateId: round.vote.candidateId,
      attempt: round.vote.attempt,
      eligibleIds: round.vote.eligibleIds,
      votedIds: [...round.vote.votes.keys()],
      myVote: round.vote.votes.get(viewerId) ?? null,
    } : null,
  }
}
