import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assignCharacters, publicRoomState } from '../src/game.js'
import {
  activePlayerId, advanceExpiredTurn, castVote, handleRoundDeparture,
  publicRoundState, requestAnswer, resetRound, startRound,
} from '../src/round.js'

function fixture() {
  const room = {
    code: 'TEST23', hostId: 'a', totalRounds: 1,
    players: new Map(['a', 'b', 'c'].map((id, index) => [id, {
      id, name: `Player ${id}`, connected: true, characters: [{ name: `Character ${index}`, imageDataUrl: `image-${index}` }],
      assignedCharacter: { name: `Character ${index}`, imageDataUrl: `image-${index}` },
    }])),
  }
  assignCharacters(room, () => 0)
  startRound(room, 1000)
  return room
}

describe('turn and unanimous vote rules', () => {
  it('rotates in joining order every 15 seconds, wrapping to the first player', () => {
    const room = fixture()
    assert.equal(room.round.deadlineAt, 16_000)
    assert.equal(advanceExpiredTurn(room, 15_999), false)
    assert.equal(activePlayerId(room), 'a')
    assert.equal(requestAnswer(room, 'a', room.round.turnId, 16_000), 'ตานี้หมดเวลาแล้ว')
    for (const [now, expected] of [[16_000, 'b'], [31_000, 'c'], [46_000, 'a']]) {
      assert.equal(advanceExpiredTurn(room, now), true)
      assert.equal(activePlayerId(room), expected)
      assert.equal(room.round.deadlineAt, now + 15_000)
    }
  })

  it('pauses for voting and resumes the same player with only the unspent time after all wrong', () => {
    const room = fixture()
    assert.equal(requestAnswer(room, 'a', room.round.turnId, 6000), null)
    assert.equal(room.round.remainingMs, 10_000)
    assert.equal(advanceExpiredTurn(room, 90_000), false)
    const voteId = room.round.vote.id
    assert.equal(castVote(room, 'b', { voteId, correct: false }, 90_000), null)
    assert.equal(room.round.phase, 'voting')
    assert.equal(castVote(room, 'c', { voteId, correct: false }, 91_000), null)
    assert.equal(room.round.phase, 'turn')
    assert.equal(activePlayerId(room), 'a')
    assert.equal(room.round.deadlineAt, 101_000)
    assert.equal(publicRoomState(room, 'a').players[0].assignedCharacter, null)
    assert.equal(advanceExpiredTurn(room, 101_000), true)
    assert.equal(activePlayerId(room), 'b')
  })

  it('discards a split vote, shows the notice to everyone, and requires all new votes', () => {
    const room = fixture()
    requestAnswer(room, 'a', room.round.turnId, 6000)
    const voteId = room.round.vote.id
    castVote(room, 'b', { voteId, correct: true })
    assert.equal(publicRoundState(room, 'c').vote.myVote, null)
    assert.deepEqual(publicRoundState(room, 'c').vote.votedIds, ['b'])
    castVote(room, 'c', { voteId, correct: false })
    assert.equal(room.round.phase, 'voting')
    assert.notEqual(room.round.vote.id, voteId)
    assert.equal(room.round.vote.votes.size, 0)
    assert.equal(room.round.vote.attempt, 2)
    assert.equal(room.round.remainingMs, 10_000)
    for (const id of ['a', 'b', 'c']) {
      assert.equal(publicRoomState(room, id).round.notice.type, 'inconclusive')
      assert.equal(publicRoomState(room, id).round.vote.myVote, null)
    }
    assert.match(castVote(room, 'c', { voteId, correct: true }), /รอบเดิม/)
  })

  it('awards points only on unanimous correct, reveals the solved answer and continues', () => {
    const room = fixture()
    requestAnswer(room, 'a', room.round.turnId, 6000)
    const voteId = room.round.vote.id
    castVote(room, 'b', { voteId, correct: true })
    assert.equal(room.status, 'playing')
    assert.equal(publicRoomState(room, 'a').players[0].assignedCharacter, null)
    castVote(room, 'c', { voteId, correct: true })
    assert.equal(room.status, 'playing')
    assert.equal(room.round.finishers[0].id, 'a')
    assert.equal(room.round.finishers[0].points, 2)
    assert.ok(publicRoomState(room, 'a').players[0].assignedCharacter)
    assert.equal(publicRoomState(room, 'b').players[1].assignedCharacter, null)
    assert.equal(activePlayerId(room), 'b')
    assert.equal(room.match.scores.get('a').total, 2)
    assert.equal(advanceExpiredTurn(room, room.round.deadlineAt), true)
    assert.equal(activePlayerId(room), 'c')
    advanceExpiredTurn(room, room.round.deadlineAt)
    assert.equal(activePlayerId(room), 'b')
  })

  it('rejects other players answering, expired turns, self-votes, duplicates, and non-booleans', () => {
    const room = fixture()
    const turnId = room.round.turnId
    assert.match(requestAnswer(room, 'b', turnId, 6000), /ตาของคุณ/)
    assert.match(requestAnswer(room, 'a', 'old-turn', 6000), /หมดเวลา/)
    requestAnswer(room, 'a', turnId, 6000)
    assert.match(requestAnswer(room, 'a', turnId, 6001), /ตอบไม่ได้/)
    const voteId = room.round.vote.id
    assert.match(castVote(room, 'a', { voteId, correct: true }), /ตัวเอง/)
    assert.match(castVote(room, 'b', { voteId, correct: 'true' }), /เลือกถูกหรือผิด/)
    castVote(room, 'b', { voteId, correct: true })
    assert.match(castVote(room, 'b', { voteId, correct: false }), /โหวตรอบนี้แล้ว/)
    assert.equal(room.round.vote.votes.size, 1)
  })

  it('cancels a departed candidate, skips their seat and resets if fewer than two remain', () => {
    const room = fixture()
    requestAnswer(room, 'a', room.round.turnId, 6000)
    room.players.delete('a')
    handleRoundDeparture(room, 'a', 7000)
    assert.equal(room.round.phase, 'turn')
    assert.equal(activePlayerId(room), 'b')
    assert.deepEqual(publicRoundState(room, 'b', 7000).order, ['b', 'c'])
    advanceExpiredTurn(room, 22_000)
    assert.equal(activePlayerId(room), 'c')
    advanceExpiredTurn(room, 37_000)
    assert.equal(activePlayerId(room), 'b')
    room.players.delete('c')
    handleRoundDeparture(room, 'c', 38_000)
    assert.equal(room.status, 'waiting')
    assert.equal(room.round, null)
    assert.deepEqual(room.players.get('b').characters, [null])
  })

  it('requires a fresh ballot after a voter leaves instead of awarding a win', () => {
    const room = fixture()
    requestAnswer(room, 'a', room.round.turnId, 6000)
    const oldId = room.round.vote.id
    castVote(room, 'b', { voteId: oldId, correct: true })
    room.players.delete('c')
    handleRoundDeparture(room, 'c', 7000)
    assert.equal(room.status, 'playing')
    assert.notEqual(room.round.vote.id, oldId)
    assert.deepEqual(room.round.vote.eligibleIds, ['b'])
    assert.equal(room.round.vote.votes.size, 0)
    resetRound(room)
    assert.equal(room.round, null)
    assert.equal(room.status, 'waiting')
  })
})
