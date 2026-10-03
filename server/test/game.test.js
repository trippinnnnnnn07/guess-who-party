import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { io as createClient } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { createDerangement } from '../src/game.js'

function connect(url) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, { transports: ['websocket'], forceNew: true })
    client.once('connect', () => resolve(client))
    client.once('connect_error', reject)
  })
}

function emitAck(client, event, payload = {}) {
  return new Promise((resolve) => client.emit(event, payload, resolve))
}

function waitForState(client, predicate) {
  return new Promise((resolve) => {
    function listener(state) {
      if (predicate(state)) {
        client.off('roomState', listener)
        resolve(state)
      }
    }
    client.on('roomState', listener)
  })
}

describe('character assignment', () => {
  it('creates a permutation where nobody keeps their own item', () => {
    const source = ['a', 'b', 'c', 'd', 'e']
    const result = createDerangement(source, () => 0)

    assert.deepEqual([...result].sort(), [...source].sort())
    result.forEach((value, index) => assert.notEqual(value, source[index]))
  })
})

describe('multiplayer room flow', () => {
  const clients = []
  let gameServer

  afterEach(async () => {
    clients.forEach((client) => client.close())
    clients.length = 0
    await gameServer?.close()
  })

  it('creates a room, joins, starts, hides own answer, and reconnects', async () => {
    gameServer = createGameServer({ clientOrigin: '*' })
    await new Promise((resolve) => gameServer.httpServer.listen(0, resolve))
    const port = gameServer.httpServer.address().port
    const url = `http://127.0.0.1:${port}`

    const host = await connect(url)
    const guest = await connect(url)
    clients.push(host, guest)

    const created = await emitAck(host, 'createRoom', { name: 'Mali' })
    assert.equal(created.ok, true)
    assert.match(created.session.roomCode, /^[A-Z2-9]{6}$/)

    const joined = await emitAck(guest, 'joinRoom', {
      name: 'Krit',
      roomCode: created.session.roomCode,
    })
    assert.equal(joined.ok, true)

    const image = 'data:image/png;base64,aA=='
    assert.equal((await emitAck(host, 'submitCharacter', { name: 'Luffy', imageDataUrl: image })).ok, true)
    assert.equal((await emitAck(guest, 'submitCharacter', { name: 'Batman', imageDataUrl: image })).ok, true)

    const guestPlayingState = waitForState(guest, (state) => state.status === 'playing')
    const started = await emitAck(host, 'startGame')
    assert.equal(started.ok, true)
    const guestState = await guestPlayingState

    const hostSelf = started.state.players.find((player) => player.isMe)
    const hostViewOfGuest = started.state.players.find((player) => !player.isMe)
    assert.equal(hostSelf.assignedCharacter, null)
    assert.equal(hostViewOfGuest.assignedCharacter.name, 'Luffy')

    const guestSelf = guestState.players.find((player) => player.isMe)
    const guestViewOfHost = guestState.players.find((player) => !player.isMe)
    assert.equal(guestSelf.assignedCharacter, null)
    assert.equal(guestViewOfHost.assignedCharacter.name, 'Batman')

    host.close()
    const reconnected = await connect(url)
    clients.push(reconnected)
    const restored = await emitAck(reconnected, 'rejoinRoom', created.session)
    assert.equal(restored.ok, true)
    assert.equal(restored.state.status, 'playing')
    assert.equal(restored.state.players.find((player) => player.isMe).assignedCharacter, null)
  })
})
