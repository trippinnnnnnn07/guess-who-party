import assert from 'node:assert/strict'
import { describe, it, afterEach } from 'node:test'
import { io } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import {
  quizSettings,
  startQuiz,
  publicQuizRoom,
  answerQuiz,
  requestQuizHint,
  nextQuizQuestion,
  advanceQuiz,
  quizDeparture,
} from '../src/odd-game.js'
import { demoBank } from '../src/quiz-demo.js'

async function fixture(count = 3, questions = 2) {
  const room = {
    code: 'QUIZ42',
    gameMode: 'odd',
    hostId: 'p0',
    players: new Map(
      Array.from({ length: count }, (_, i) => [
        `p${i}`,
        { id: `p${i}`, name: `Player ${i}`, connected: true },
      ]),
    ),
    quizSettings: quizSettings({ questionCount: questions }),
  }
  startQuiz(room, await demoBank.pick(room.quizSettings), 1000)
  return room
}
const correct = (r) =>
  r.quiz.questions[r.quiz.index].options.find((o) => o.correct).id
const answer = (r, id, optionId = correct(r), now = 1100) =>
  answerQuiz(r, id, { questionToken: r.quiz.questionToken, optionId }, now)
const hint = (r, id, now = 1100) =>
  requestQuizHint(r, id, { questionToken: r.quiz.questionToken }, now)

describe('odd-one-out authoritative game rules', () => {
  it('validates settings and snapshots the bank without revealing secrets or future questions', async () => {
    assert.throws(() => quizSettings({ blindSeconds: 0 }))
    assert.throws(() => quizSettings({ hintSeconds: 601 }))
    assert.throws(() => quizSettings({ questionCount: 1.5 }))
    assert.throws(() => quizSettings({ categoryIds: 'anime' }))
    const r = await fixture()
    const s = publicQuizRoom(r, 'p0', 1000)
    assert.equal(s.quiz.hint, null)
    assert.equal(s.quiz.explanation, null)
    assert.equal(s.quiz.correctOptionId, null)
    assert.equal(s.quiz.question.options.length, 4)
    assert.equal(JSON.stringify(s).includes('correct_index'), false)
    assert.equal(JSON.stringify(s).includes('imagePath'), false)
    assert.equal(JSON.stringify(s).includes('demo-1'), false)
    assert.ok(
      s.quiz.question.options.every((o) => !Object.hasOwn(o, 'correct')),
    )
  })
  it('locks one answer, keeps other choices and correctness private, and early-skips to hint', async () => {
    const r = await fixture()
    assert.equal(answer(r, 'p0'), null)
    assert.ok(answer(r, 'p0'))
    assert.equal(publicQuizRoom(r, 'p1').quiz.myAnswer, null)
    assert.equal(
      publicQuizRoom(r, 'p1').standings.every((p) => p.total === 0),
      true,
    )
    assert.equal(hint(r, 'p1'), null)
    assert.ok(answer(r, 'p1'))
    assert.equal(r.quiz.phase, 'blind')
    hint(r, 'p2', 1200)
    assert.equal(r.quiz.phase, 'hint')
    assert.equal(r.quiz.deadlineAt, 31200)
    assert.ok(publicQuizRoom(r, 'p0').quiz.hint)
    assert.equal(publicQuizRoom(r, 'p0').quiz.correctOptionId, null)
    answer(r, 'p1', correct(r), 1300)
    const wrong = r.quiz.questions[0].options.find((o) => !o.correct).id
    answer(r, 'p2', wrong, 1301)
    assert.equal(r.quiz.phase, 'reveal')
    assert.deepEqual(
      publicQuizRoom(r, 'p0').quiz.result.rows.map((p) => p.points),
      [3, 1, 0],
    )
  })
  it('skips hint entirely when everyone answers; totals multiple questions and ties', async () => {
    const r = await fixture(2)
    const oldToken = r.quiz.questionToken
    answer(r, 'p0')
    answer(r, 'p1')
    assert.equal(r.quiz.phase, 'reveal')
    assert.equal(nextQuizQuestion(r, oldToken, 2000), null)
    assert.ok(nextQuizQuestion(r, oldToken, 2100))
    assert.ok(
      answerQuiz(
        r,
        'p0',
        { questionToken: oldToken, optionId: correct(r) },
        2100,
      ),
    )
    answer(r, 'p0', correct(r), 2100)
    answer(r, 'p1', correct(r), 2200)
    const s = publicQuizRoom(r, 'p0')
    assert.equal(s.status, 'finished')
    assert.deepEqual(
      s.standings.map((p) => p.total),
      [6, 6],
    )
    assert.deepEqual(s.winnerIds, ['p0', 'p1'])
    assert.equal(s.quiz.results.length, 2)
    assert.ok(answer(r, 'p0'))
  })
  it('uses deadline boundaries, gives late phase answers 1 point, and gives no-answer zero', async () => {
    const r = await fixture(2, 1)
    assert.equal(r.quiz.deadlineAt, 61000)
    answer(r, 'p0', correct(r), 61000)
    assert.equal(r.quiz.phase, 'hint')
    assert.equal(r.quiz.answers.get('p0').phase, 'hint')
    assert.equal(advanceQuiz(r, 90999), false)
    assert.equal(advanceQuiz(r, 91000), true)
    assert.deepEqual(
      publicQuizRoom(r, 'p0').quiz.result.rows.map((p) => p.points),
      [1, 0],
    )
    assert.equal(advanceQuiz(r, 999999), false)
  })
  it('handles delayed timer callbacks and departed players without resetting clocks', async () => {
    const r = await fixture(2, 1)
    advanceQuiz(r, 999999)
    assert.equal(r.status, 'finished')
    const r2 = await fixture()
    hint(r2, 'p0')
    hint(r2, 'p1')
    r2.players.get('p2').connected = false
    assert.equal(r2.quiz.phase, 'blind')
    r2.players.delete('p2')
    quizDeparture(r2, 1500)
    assert.equal(r2.quiz.phase, 'hint')
    assert.equal(r2.quiz.deadlineAt, 31500)
  })
  it('refuses insufficient questions rather than silently broadening category selection', async () => {
    const r = await fixture()
    assert.throws(() => startQuiz(r, [], 1000), /ไม่พอ/)
  })
})

describe('odd-one-out real Socket.IO flow', () => {
  let game
  const clients = []
  afterEach(async () => {
    for (const c of clients) c.disconnect()
    clients.length = 0
    await game?.close()
  })
  async function setup() {
    game = createGameServer({ quizDemo: true })
    await new Promise((r) => game.httpServer.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${game.httpServer.address().port}`
    for (let i = 0; i < 3; i++) {
      const client = io(url, { transports: ['websocket'], forceNew: true })
      clients.push(client)
      await new Promise((r) => client.once('connect', r))
    }
    return url
  }
  const emit = (client, event, payload = {}) =>
    new Promise((resolve, reject) =>
      client
        .timeout(3000)
        .emit(event, payload, (e, value) => (e ? reject(e) : resolve(value))),
    )
  it('creates, joins, locks answers, reconnects privately, transfers host, resets and rejects stale actions', async () => {
    await setup()
    const made = await emit(clients[0], 'quizCreate', {
      name: 'Host',
      settings: { questionCount: 1, blindSeconds: 5, hintSeconds: 5 },
    })
    const joined = await emit(clients[1], 'joinRoom', {
      name: 'Friend',
      roomCode: made.session.roomCode,
    })
    assert.equal(made.ok, true)
    assert.equal(joined.ok, true)
    assert.equal((await emit(clients[1], 'quizStart')).ok, false)
    assert.equal((await emit(clients[0], 'startGame')).ok, false)
    assert.equal((await emit(clients[0], 'quizStart')).ok, true)
    const room = game.rooms.get(made.session.roomCode)
    const token = room.quiz.questionToken
    const optionId = correct(room)
    const answered = await emit(clients[0], 'quizAnswer', {
      questionToken: token,
      optionId,
    })
    assert.equal(answered.state.quiz.correctOptionId, null)
    assert.equal(
      (await emit(clients[0], 'quizAnswer', { questionToken: token, optionId }))
        .ok,
      false,
    )
    assert.equal(
      (
        await emit(clients[2], 'rejoinRoom', {
          ...made.session,
          sessionToken: 'fake',
        })
      ).ok,
      false,
    )
    const rejoined = await emit(clients[2], 'rejoinRoom', made.session)
    assert.equal(rejoined.state.quiz.myAnswer, optionId)
    assert.equal(
      (await emit(clients[0], 'quizHint', { questionToken: token })).ok,
      false,
    )
    const hinted = await emit(clients[1], 'quizHint', { questionToken: token })
    assert.equal(hinted.state.quiz.phase, 'hint')
    assert.equal(hinted.state.quiz.myAnswer, null)
    const final = await emit(clients[1], 'quizAnswer', {
      questionToken: token,
      optionId,
    })
    assert.equal(final.state.status, 'finished')
    assert.deepEqual(
      final.state.standings.map((p) => p.total),
      [3, 1],
    )
    await emit(clients[2], 'leaveRoom')
    const reset = await emit(clients[1], 'resetGame')
    assert.equal(reset.ok, true)
    assert.equal(reset.state.quiz, null)
    assert.equal(
      (await emit(clients[1], 'quizAnswer', { questionToken: token, optionId }))
        .ok,
      false,
    )
  })
  it('does not expose the question bank or permit authorship without Google authentication', async () => {
    const url = await setup()
    const config = await (await fetch(`${url}/api/quiz/config`)).json()
    assert.equal(config.demo, true)
    assert.equal(config.configured, false)
    assert.equal(Object.hasOwn(config, 'secretKey'), false)
    assert.equal((await fetch(`${url}/api/quiz/questions`)).status, 503)
    assert.equal((await fetch(`${url}/api/quiz/categories`)).status, 200)
  })
})
