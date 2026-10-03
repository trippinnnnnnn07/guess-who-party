import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { io } from 'socket.io-client'
import { createGameServer } from '../src/app.js'

const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='

function ack(client, event, payload = {}) {
  return new Promise((resolve, reject) => {
    client.timeout(3000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response))
  })
}

function nextState(client, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off('roomState', onState)
      reject(new Error('Timed out waiting for room state'))
    }, 3000)
    function onState(state) {
      if (!predicate(state)) return
      clearTimeout(timeout)
      client.off('roomState', onState)
      resolve(state)
    }
    client.on('roomState', onState)
  })
}

describe('v0.2 socket flow', { timeout: 10_000 }, () => {
  let server
  const sockets = []
  async function connect(url) {
    const client = io(url, { transports: ['websocket'], forceNew: true, reconnection: false })
    sockets.push(client)
    await new Promise((resolve, reject) => {
      client.once('connect', resolve)
      client.once('connect_error', reject)
    })
    return client
  }

  async function setup(durationMs) {
    server = createGameServer({ clientOrigin: '*', turnDurationMs: durationMs })
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.httpServer.address().port}`
    const clients = []
    const sessions = []
    let code
    for (const name of ['Mali', 'Krit', 'Fah']) {
      const client = await connect(url)
      clients.push(client)
      const result = await ack(client, code ? 'joinRoom' : 'createRoom', { name, roomCode: code })
      assert.equal(result.ok, true)
      sessions.push(result.session)
      code = result.session.roomCode
      assert.equal((await ack(client, 'submitCharacter', { name: `Character-${name}`, imageDataUrl: IMAGE })).ok, true)
    }
    const start = await ack(clients[0], 'startGame')
    assert.equal(start.ok, true)
    return { clients, sessions, code, start: start.state, url }
  }

  afterEach(async () => {
    sockets.forEach((client) => client.close())
    sockets.length = 0
    await server?.close()
  })

  it('broadcasts a real timer transition and rejects an answer for the previous turn', async () => {
    const { clients, sessions, start } = await setup(250)
    assert.deepEqual(start.round.order, sessions.map((session) => session.playerId))
    const next = await nextState(clients[1], (state) => state.round?.turnNumber === 2)
    assert.equal(next.round.activePlayerId, sessions[1].playerId)
    assert.equal((await ack(clients[0], 'requestAnswer', { turnId: start.round.turnId })).ok, false)
    assert.equal((await ack(clients[1], 'requestAnswer', { turnId: next.round.turnId })).ok, true)
  })

  it('retries split votes for everyone, wins unanimously, and restores the revealed answer', async () => {
    const { clients: [host, guest, third], sessions, start, url } = await setup()
    assert.equal(start.round.durationMs, 15_000)
    assert.equal((await ack(guest, 'requestAnswer', { turnId: start.round.turnId })).ok, false)
    const answer = await ack(host, 'requestAnswer', { turnId: start.round.turnId })
    assert.equal(answer.ok, true)
    let voteId = answer.state.round.vote.id
    assert.equal((await ack(host, 'castVote', { voteId, correct: true })).ok, false)
    assert.equal((await ack(guest, 'castVote', { voteId, correct: true })).ok, true)
    assert.equal((await ack(guest, 'castVote', { voteId, correct: true })).ok, false)
    const waitingForSplit = clientsStatePromises([host, guest, third], (state) => state.round?.vote?.attempt === 2)
    const split = await ack(third, 'castVote', { voteId, correct: false })
    assert.equal(split.ok, true)
    for (const state of await waitingForSplit) {
      assert.equal(state.round.notice.type, 'inconclusive')
      assert.deepEqual(state.round.vote.votedIds, [])
    }
    assert.equal((await ack(guest, 'castVote', { voteId, correct: true })).ok, false)
    voteId = split.state.round.vote.id
    await ack(guest, 'castVote', { voteId, correct: true })
    const hostWin = nextState(host, (state) => state.status === 'finished')
    const won = await ack(third, 'castVote', { voteId, correct: true })
    assert.equal(won.state.round.winner.id, sessions[0].playerId)
    const hostState = await hostWin
    assert.ok(hostState.players.find((player) => player.isMe).assignedCharacter)
    assert.equal(won.state.players.find((player) => player.isMe).assignedCharacter, null)
    host.close()
    const replacement = await connect(url)
    const restored = await ack(replacement, 'rejoinRoom', sessions[0])
    assert.equal(restored.state.status, 'finished')
    assert.ok(restored.state.players.find((player) => player.isMe).assignedCharacter)
    assert.equal((await ack(replacement, 'startGame')).ok, false)
    const reset = await ack(replacement, 'resetGame')
    assert.equal(reset.state.status, 'waiting')
    assert.equal(reset.state.round, null)
  })

  it('keeps votes and paused time across reconnect and resumes after a unanimous wrong result', async () => {
    const { clients: [host, guest, third], sessions, start, url } = await setup()
    const answer = await ack(host, 'requestAnswer', { turnId: start.round.turnId })
    const voteId = answer.state.round.vote.id
    await ack(guest, 'castVote', { voteId, correct: false })
    const disconnected = nextState(host, (state) => !state.players.find((player) => player.id === sessions[1].playerId).connected)
    guest.close()
    await disconnected
    const replacement = await connect(url)
    const restored = await ack(replacement, 'rejoinRoom', sessions[1])
    assert.equal(restored.state.round.vote.myVote, false)
    assert.equal(restored.state.round.vote.id, voteId)
    assert.equal(restored.state.round.remainingMs, answer.state.round.remainingMs)
    const result = await ack(third, 'castVote', { voteId, correct: false })
    assert.equal(result.state.round.phase, 'turn')
    assert.equal(result.state.round.activePlayerId, sessions[0].playerId)
    assert.equal(result.state.round.notice.type, 'wrong')
    assert.equal(result.state.round.winner, null)
  })

  it('cancels a pending vote on reset, refuses stale votes, and prevents non-host resets', async () => {
    const { clients: [host, guest], start } = await setup()
    const answer = await ack(host, 'requestAnswer', { turnId: start.round.turnId })
    assert.equal((await ack(guest, 'resetGame')).ok, false)
    assert.equal((await ack(host, 'startGame')).ok, false)
    const reset = await ack(host, 'resetGame')
    assert.equal(reset.state.status, 'waiting')
    assert.equal((await ack(guest, 'castVote', { voteId: answer.state.round.vote.id, correct: true })).ok, false)
    assert.ok(reset.state.players.every((player) => !player.isReady && !player.assignedCharacter))
  })

  it('does not let another player take over a voter using their public player ID', async () => {
    const { clients: [host, guest], sessions, code, start } = await setup()
    assert.equal(JSON.stringify(start).includes(sessions[0].sessionToken), false)
    const stolen = await ack(guest, 'rejoinRoom', { roomCode: code, playerId: sessions[0].playerId })
    assert.equal(stolen.ok, false)
    const forged = await ack(guest, 'rejoinRoom', { ...sessions[0], sessionToken: sessions[1].sessionToken })
    assert.equal(forged.ok, false)
    const answer = await ack(host, 'requestAnswer', { turnId: start.round.turnId })
    assert.equal(answer.ok, true)
    assert.equal((await ack(guest, 'castVote', { voteId: answer.state.round.vote.id, correct: true })).ok, true)
  })

  it('moves to the next player after the current host leaves during voting', async () => {
    const { clients: [host, guest], sessions, start } = await setup()
    await ack(host, 'requestAnswer', { turnId: start.round.turnId })
    const changed = nextState(guest, (state) => state.round?.activePlayerId === sessions[1].playerId)
    await ack(host, 'leaveRoom')
    const state = await changed
    assert.equal(state.hostId, sessions[1].playerId)
    assert.equal(state.round.phase, 'turn')
    assert.equal(state.round.vote, null)
    assert.equal(state.playerCount, 2)
    assert.equal(state.round.order.length, 2)
  })

  function clientsStatePromises(clients, predicate) {
    return Promise.all(clients.map((client) => nextState(client, predicate)))
  }
})
