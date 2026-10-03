import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { io } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { assignCharacters, publicRoomState } from '../src/game.js'
import { activePlayerId, advanceExpiredTurn, castVote, handleRoundDeparture, requestAnswer, resetRound, startRound } from '../src/round.js'

const IMAGE = 'data:image/png;base64,aA=='

function fixture(count = 4, totalRounds = 3) {
  const room = {
    code: 'MATCH3', totalRounds, hostId: 'p0',
    players: new Map(Array.from({ length: count }, (_, i) => {
      const id = `p${i}`
      return [id, { id, name: id, connected: true, characters: Array.from({ length: totalRounds }, (_, r) => ({ name: `ROUND-${r}-OWNER-${id}`, imageDataUrl: IMAGE })) }]
    })),
  }
  assignCharacters(room, () => 0)
  startRound(room, 1000)
  return room
}

function solve(room, now = 1100) {
  const id = activePlayerId(room)
  const turnId = room.round.turnId
  assert.equal(requestAnswer(room, id, turnId, now), null)
  const voteId = room.round.vote.id
  for (const voter of room.players.keys()) {
    if (voter !== id) assert.equal(castVote(room, voter, { voteId, correct: true }, now), null)
  }
  return { id, turnId, voteId }
}

describe('v0.3 multi-round scoring rules', () => {
  it('assigns each slot once to a different owner in every round and never publishes future answers', () => {
    const room = fixture()
    const seen = new Set()
    for (let r = 0; r < 3; r++) {
      for (const player of room.players.values()) {
        const answer = player.assignedCharacter
        assert.notEqual(answer.name, player.characters[r].name)
        assert.match(answer.name, new RegExp(`^ROUND-${r}-`))
        assert.equal(seen.has(answer.name), false)
        seen.add(answer.name)
        const state = publicRoomState(room, player.id)
        assert.equal(state.players.find((p) => p.isMe).assignedCharacter, null)
        assert.deepEqual(state.myCharacters, [])
        for (let future = r + 1; future < 3; future++) {
          assert.equal(JSON.stringify(state).includes(`ROUND-${future}-`), false)
        }
      }
      const now = room.round.deadlineAt - 100
      for (let rank = 0; rank < 3; rank++) solve(room, now)
      if (r < 2) advanceExpiredTurn(room, room.round.deadlineAt)
    }
    assert.equal(seen.size, 12)
    assert.equal(room.status, 'finished')
  })

  it('awards 3/2/1/0, continues after the first finisher, and totals three rounds', () => {
    const room = fixture()
    for (let r = 0; r < 3; r++) {
      const now = room.round.deadlineAt - 100
      for (let rank = 1; rank <= 3; rank++) {
        const { id, voteId } = solve(room, now)
        assert.equal(room.match.scores.get(id).rounds[r], 4 - rank)
        assert.ok(publicRoomState(room, id).players.find((p) => p.isMe).assignedCharacter)
        assert.match(castVote(room, id, { voteId, correct: true }, now), /ไม่มีคำตอบ/)
        if (rank < 3) {
          assert.equal(room.round.phase, 'turn')
          assert.notEqual(activePlayerId(room), id)
        }
      }
      assert.deepEqual(room.round.finishers.map((entry) => entry.points), [3, 2, 1, 0])
      assert.equal(room.round.finishers[3].solved, false)
      assert.ok(publicRoomState(room, activePlayerId(room)).players.every((p) => p.assignedCharacter))
      if (r < 2) {
        assert.equal(room.round.phase, 'intermission')
        assert.equal(advanceExpiredTurn(room, room.round.deadlineAt - 1), false)
        assert.match(requestAnswer(room, 'p0', room.round.turnId, now), /ตอบไม่ได้/)
        assert.equal(advanceExpiredTurn(room, room.round.deadlineAt), true)
        assert.equal(room.round.finishers.length, 0)
      }
    }
    const state = publicRoomState(room, 'p0')
    assert.deepEqual(state.standings.map((entry) => [entry.id, entry.total]), [['p2', 6], ['p1', 5], ['p0', 4], ['p3', 3]])
    assert.deepEqual(state.winnerIds, ['p2'])
    assert.equal(state.results.length, 3)
    assert.equal(advanceExpiredTurn(room, 999_999), false)
    assert.equal(state.round.deadlineAt, null)
  })

  it('skips solved players in the turn queue but still requires their vote', () => {
    const room = fixture()
    solve(room)
    assert.equal(activePlayerId(room), 'p1')
    advanceExpiredTurn(room, room.round.deadlineAt)
    advanceExpiredTurn(room, room.round.deadlineAt)
    advanceExpiredTurn(room, room.round.deadlineAt)
    assert.equal(activePlayerId(room), 'p1')
    const now = room.round.deadlineAt - 100
    requestAnswer(room, 'p1', room.round.turnId, now)
    const voteId = room.round.vote.id
    castVote(room, 'p2', { voteId, correct: true }, now)
    castVote(room, 'p3', { voteId, correct: true }, now)
    assert.equal(room.round.phase, 'voting')
    assert.deepEqual(room.round.vote.eligibleIds, ['p0', 'p2', 'p3'])
    castVote(room, 'p0', { voteId, correct: true }, now)
    assert.equal(room.round.finishers.length, 2)
  })

  it('supports variable room sizes, single rounds and shared winners', () => {
    for (const count of [2, 3, 6]) {
      const room = fixture(count, 1)
      for (let i = 1; i < count; i++) solve(room)
      assert.equal(room.status, 'finished')
      assert.deepEqual(room.round.finishers.map((entry) => entry.points), Array.from({ length: count }, (_, i) => count - i - 1))
    }
    const tied = fixture(2, 2)
    solve(tied)
    advanceExpiredTurn(tied, tied.round.deadlineAt)
    solve(tied, tied.round.deadlineAt - 100)
    assert.deepEqual(publicRoomState(tied, 'p0').winnerIds, ['p0', 'p1'])
    assert.deepEqual([...tied.match.scores.values()].map((entry) => entry.total), [1, 1])
    resetRound(tied)
    assert.equal(tied.match, null)
    assert.equal(tied.totalRounds, 2)
    assert.ok([...tied.players.values()].every((p) => p.characters.every((c) => c === null)))
  })

  it('settles a round after a departure and preserves valid future assignments for the remaining players', () => {
    const room = fixture(4, 2)
    solve(room)
    solve(room)
    room.players.delete('p2')
    handleRoundDeparture(room, 'p2', 1200)
    assert.equal(room.round.phase, 'intermission')
    assert.equal(room.match.results.length, 1)
    assert.equal(room.match.scores.get('p3').rounds[0], 0)
    assert.equal(room.match.scores.get('p2').rounds[0], 0)
    advanceExpiredTurn(room, room.round.deadlineAt)
    assert.equal(room.round.order.length, 3)
    for (const player of room.players.values()) {
      assert.ok(player.assignedCharacter)
      assert.notEqual(player.assignedCharacter.name, player.characters[1].name)
    }
  })
})

function ack(client, event, payload = {}) {
  return new Promise((resolve, reject) => client.timeout(3000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)))
}

function nextState(client, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off('roomState', listen); reject(new Error('State timeout')) }, 3000)
    function listen(state) {
      if (!predicate(state)) return
      clearTimeout(timer)
      client.off('roomState', listen)
      resolve(state)
    }
    client.on('roomState', listen)
  })
}

describe('v0.3 multi-round Socket.IO integration', { timeout: 15_000 }, () => {
  let server
  let url
  const clients = []
  async function connect() {
    const socket = io(url, { forceNew: true, transports: ['websocket'], reconnection: false })
    clients.push(socket)
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
    return socket
  }
  async function setup(count = 4, totalRounds = 3) {
    server = createGameServer({ clientOrigin: '*', intermissionMs: 150 })
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${server.httpServer.address().port}`
    const sessions = []
    let code
    for (let p = 0; p < count; p++) {
      const client = await connect()
      const result = await ack(client, code ? 'joinRoom' : 'createRoom', { name: `Player ${p}`, totalRounds, roomCode: code })
      assert.equal(result.ok, true)
      sessions.push(result.session)
      code = result.session.roomCode
    }
    return { sessions, code }
  }
  afterEach(async () => { clients.forEach((client) => client.close()); clients.length = 0; await server?.close() })

  it('validates round counts and slots, persists partial submissions, and refuses to start until everyone has every slot', async () => {
    const { sessions } = await setup(2, 3)
    for (const totalRounds of [0, 11, 1.5, '3']) {
      assert.equal((await ack(clients[0], 'createRoom', { name: 'No', totalRounds })).ok, false)
    }
    for (const roundIndex of [-1, 3, 1.1, '1']) {
      assert.equal((await ack(clients[0], 'submitCharacter', { roundIndex, name: 'No', imageDataUrl: IMAGE })).ok, false)
    }
    assert.equal((await ack(clients[0], 'submitCharacter', { roundIndex: 1, name: 'No', imageDataUrl: 'https://invalid.test/a.png' })).ok, false)
    const partial = await ack(clients[0], 'submitCharacter', { roundIndex: 1, name: 'Private answer', imageDataUrl: IMAGE })
    assert.equal(partial.state.players[0].submittedCount, 1)
    assert.equal(partial.state.players[0].isReady, false)
    assert.equal((await ack(clients[0], 'startGame')).ok, false)
    const other = await ack(clients[1], 'rejoinRoom', sessions[1])
    assert.equal(JSON.stringify(other.state).includes('Private answer'), false)
    const restored = await ack(clients[0], 'rejoinRoom', sessions[0])
    assert.equal(restored.state.myCharacters[1].name, 'Private answer')
    for (const client of clients) for (let r = 0; r < 3; r++) {
      await ack(client, 'submitCharacter', { roundIndex: r, name: `Slot ${r}`, imageDataUrl: IMAGE })
    }
    assert.equal((await ack(clients[1], 'startGame')).ok, false)
    assert.equal((await ack(clients[0], 'startGame')).ok, true)
    assert.equal((await ack(clients[0], 'submitCharacter', { roundIndex: 0, name: 'Late', imageDataUrl: IMAGE })).ok, false)
  })

  it('plays four real clients through three rounds, auto-advances, and restores cumulative final scores', async () => {
    const { sessions } = await setup()
    for (let p = 0; p < 4; p++) for (let r = 0; r < 3; r++) {
      const submitted = await ack(clients[p], 'submitCharacter', { roundIndex: r, name: `ROUND-${r}-OWNER-${p}`, imageDataUrl: IMAGE })
      assert.equal(submitted.ok, true)
    }
    let state = (await ack(clients[0], 'startGame')).state
    for (let r = 1; r <= 3; r++) {
      assert.equal(state.round.number, r)
      const futureRound = r < 3 ? nextState(clients[0], (s) => s.round?.number === r + 1) : null
      for (let rank = 1; rank <= 3; rank++) {
        const index = sessions.findIndex((s) => s.playerId === state.round.activePlayerId)
        const answer = await ack(clients[index], 'requestAnswer', { turnId: state.round.turnId })
        assert.equal(answer.ok, true)
        for (let voter = 0; voter < 4; voter++) if (voter !== index) {
          const vote = await ack(clients[voter], 'castVote', { voteId: answer.state.round.vote.id, correct: true })
          assert.equal(vote.ok, true)
          state = vote.state
        }
      }
      assert.deepEqual(state.round.finishers.map((entry) => entry.points), [3, 2, 1, 0])
      if (r < 3) {
        assert.equal(state.round.phase, 'intermission')
        const restored = await ack(clients[0], 'rejoinRoom', sessions[0])
        assert.equal(restored.state.round.phase, 'intermission')
        assert.ok(restored.state.players.find((p) => p.isMe).assignedCharacter)
        state = await futureRound
        assert.equal(state.players.find((p) => p.isMe).assignedCharacter, null)
      }
    }
    assert.equal(state.status, 'finished')
    assert.equal(state.results.length, 3)
    assert.deepEqual(state.standings.map((entry) => entry.total), [6, 5, 4, 3])
    assert.deepEqual(state.winnerIds, [sessions[2].playerId])
    clients[0].close()
    const replacement = await connect()
    const restored = await ack(replacement, 'rejoinRoom', sessions[0])
    assert.equal(restored.state.status, 'finished')
    assert.deepEqual(restored.state.standings, state.standings)
    assert.ok(restored.state.players.find((p) => p.isMe).assignedCharacter)
    const reset = await ack(replacement, 'resetGame')
    assert.equal(reset.state.status, 'waiting')
    assert.deepEqual(reset.state.standings, [])
    assert.deepEqual(reset.state.myCharacters, [null, null, null])
  })
})
