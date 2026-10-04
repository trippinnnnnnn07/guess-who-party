import { randomUUID, randomInt } from 'node:crypto'

export function quizSettings(payload = {}) {
  const settings = {
    questionCount: payload.questionCount ?? 5,
    blindSeconds: payload.blindSeconds ?? 60,
    hintSeconds: payload.hintSeconds ?? 30,
    categoryIds: payload.categoryIds ?? [],
  }
  if (
    !Number.isInteger(settings.questionCount) ||
    settings.questionCount < 1 ||
    settings.questionCount > 20
  )
    throw new Error('เลือกจำนวนข้อ 1–20 ข้อ')
  for (const key of ['blindSeconds', 'hintSeconds']) {
    if (
      !Number.isInteger(settings[key]) ||
      settings[key] < 5 ||
      settings[key] > 600
    )
      throw new Error('เวลาของแต่ละช่วงต้องอยู่ระหว่าง 5 วินาที ถึง 10 นาที')
  }
  if (
    !Array.isArray(settings.categoryIds) ||
    settings.categoryIds.length > 30 ||
    settings.categoryIds.some(
      (id) => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,50}$/.test(id),
    )
  )
    throw new Error('หมวดหมู่ไม่ถูกต้อง')
  settings.categoryIds = [...new Set(settings.categoryIds)]
  return settings
}

function shuffled(items) {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function startQuiz(room, questions, now = Date.now()) {
  if (questions.length !== room.quizSettings.questionCount)
    throw new Error(
      `โจทย์ที่ใช้ได้มี ${questions.length} ข้อ ไม่พอสำหรับ ${room.quizSettings.questionCount} ข้อ กรุณาลดจำนวนข้อหรือเลือกหมวดเพิ่ม`,
    )
  // Snapshot the reviewed content. Edits in the bank cannot change a running match.
  room.quiz = {
    questions: questions.map((q) => {
      const copy = structuredClone(q)
      copy.options = shuffled(
        copy.options.map((option, index) => ({
          ...option,
          id: randomUUID(),
          correct: index === copy.correct_index,
        })),
      )
      return copy
    }),
    index: 0,
    results: [],
    scores: new Map(
      [...room.players.values()].map((p) => [
        p.id,
        { id: p.id, name: p.name, total: 0 },
      ]),
    ),
  }
  room.status = 'playing'
  beginQuestion(room, now)
}

function beginQuestion(room, now) {
  Object.assign(room.quiz, {
    phase: 'blind',
    questionToken: randomUUID(),
    deadlineAt: now + room.quizSettings.blindSeconds * 1000,
    answers: new Map(),
    hintRequests: new Set(),
  })
}

function finishQuestion(room, now) {
  const quiz = room.quiz
  const question = quiz.questions[quiz.index]
  const correctOptionId = question.options.find((o) => o.correct).id
  const rows = [...quiz.scores.values()].map((player) => {
    const answer = quiz.answers.get(player.id)
    const correct = answer?.optionId === correctOptionId
    const points = correct ? (answer.phase === 'blind' ? 3 : 1) : 0
    player.total += points
    return {
      id: player.id,
      name: player.name,
      optionId: answer?.optionId ?? null,
      correct,
      points,
    }
  })
  quiz.results.push({
    number: quiz.index + 1,
    title: question.title,
    correctOptionId,
    rows,
  })
  quiz.phase = 'reveal'
  quiz.deadlineAt = null
  if (quiz.index === quiz.questions.length - 1) {
    quiz.phase = 'finished'
    room.status = 'finished'
  }
  room.lastActiveAt = now
}

function maybeAdvance(room, now) {
  const quiz = room.quiz
  if (!quiz || !['blind', 'hint'].includes(quiz.phase)) return
  // Disconnected players still count until timeout; leaving explicitly removes them.
  const ids = [...room.players.keys()]
  if (!ids.length || ids.every((id) => quiz.answers.has(id)))
    return finishQuestion(room, now)
  if (
    quiz.phase === 'blind' &&
    ids.every((id) => quiz.answers.has(id) || quiz.hintRequests.has(id))
  ) {
    quiz.phase = 'hint'
    quiz.deadlineAt = now + room.quizSettings.hintSeconds * 1000
  }
}

export function advanceQuiz(room, now = Date.now()) {
  const quiz = room.quiz
  if (
    !quiz ||
    room.status !== 'playing' ||
    !quiz.deadlineAt ||
    now < quiz.deadlineAt
  )
    return false
  if (quiz.phase === 'blind') {
    quiz.phase = 'hint'
    // Use the authoritative deadline, not callback arrival time.
    quiz.deadlineAt += room.quizSettings.hintSeconds * 1000
    if (now >= quiz.deadlineAt) finishQuestion(room, now)
  } else if (quiz.phase === 'hint') finishQuestion(room, now)
  return true
}

export function answerQuiz(room, playerId, payload, now = Date.now()) {
  advanceQuiz(room, now)
  const quiz = room.quiz
  if (
    !quiz ||
    !['blind', 'hint'].includes(quiz.phase) ||
    payload?.questionToken !== quiz.questionToken
  )
    return 'ข้อนี้ปิดรับคำตอบแล้ว'
  if (quiz.answers.has(playerId)) return 'คุณยืนยันคำตอบข้อนี้ไปแล้ว'
  if (quiz.phase === 'blind' && quiz.hintRequests.has(playerId))
    return 'คุณขอคำใบ้แล้ว กรุณารอช่วงคำใบ้'
  if (
    !quiz.questions[quiz.index].options.some((o) => o.id === payload?.optionId)
  )
    return 'ตัวเลือกไม่ถูกต้อง'
  quiz.answers.set(playerId, { optionId: payload.optionId, phase: quiz.phase })
  maybeAdvance(room, now)
  return null
}

export function requestQuizHint(room, playerId, payload, now = Date.now()) {
  advanceQuiz(room, now)
  const quiz = room.quiz
  if (
    !quiz ||
    quiz.phase !== 'blind' ||
    payload?.questionToken !== quiz.questionToken
  )
    return 'ไม่สามารถขอคำใบ้ในช่วงนี้ได้'
  if (quiz.answers.has(playerId)) return 'คุณยืนยันคำตอบไปแล้ว'
  quiz.hintRequests.add(playerId)
  maybeAdvance(room, now)
  return null
}

export function nextQuizQuestion(room, token, now = Date.now()) {
  if (room.quiz?.phase !== 'reveal' || token !== room.quiz.questionToken)
    return 'ยังไปข้อถัดไปไม่ได้'
  room.quiz.index++
  beginQuestion(room, now)
  return null
}

export function quizDeparture(room, now = Date.now()) {
  maybeAdvance(room, now)
}

export function publicQuizRoom(room, viewerId, now = Date.now()) {
  const quiz = room.quiz
  const revealed = quiz && ['reveal', 'finished'].includes(quiz.phase)
  const question = quiz?.questions[quiz.index]
  const standings = quiz
    ? [...quiz.scores.values()]
        .map((p) => ({ ...p, departed: !room.players.has(p.id) }))
        .sort((a, b) => b.total - a.total)
    : []
  return {
    code: room.code,
    gameMode: 'odd',
    status: room.status,
    hostId: room.hostId,
    settings: room.quizSettings,
    playerCount: room.players.size,
    allConnected: [...room.players.values()].every((p) => p.connected),
    demo: Boolean(room.demo),
    serverNow: now,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isMe: p.id === viewerId,
      isHost: p.id === room.hostId,
      answered: quiz?.answers.has(p.id) ?? false,
      requestedHint: quiz?.hintRequests.has(p.id) ?? false,
    })),
    standings,
    winnerIds:
      room.status === 'finished'
        ? standings
            .filter((p) => p.total === standings[0]?.total)
            .map((p) => p.id)
        : [],
    quiz: quiz
      ? {
          number: quiz.index + 1,
          total: quiz.questions.length,
          phase: quiz.phase,
          questionToken: quiz.questionToken,
          deadlineAt: quiz.deadlineAt,
          question: {
            title: question.title,
            options: question.options.map((o) => ({
              id: o.id,
              name: o.name,
              source: o.source,
              imageUrl: o.imageUrl,
            })),
          },
          hint: quiz.phase !== 'blind' ? question.hint : null,
          explanation: revealed ? question.explanation : null,
          correctOptionId: revealed
            ? question.options.find((o) => o.correct).id
            : null,
          myAnswer: quiz.answers.get(viewerId)?.optionId ?? null,
          result: revealed ? quiz.results.at(-1) : null,
          results: quiz.results,
        }
      : null,
  }
}
