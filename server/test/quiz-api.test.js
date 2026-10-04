import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGameServer } from '../src/app.js'
import { validateQuestion, validImage } from '../src/quiz-api.js'
import { createQuizRepository, QuizError } from '../src/quiz-repository.js'

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Member',
  isAdmin: false,
}
const path = `${user.id}/22222222-2222-4222-8222-222222222222.png`
const body = {
  title: 'Question',
  category_id: '33333333-3333-4333-8333-333333333333',
  status: 'pending',
  hint: 'hint',
  explanation: 'reason',
  correct_index: 0,
  options: Array.from({ length: 4 }, () => ({
    name: 'Name',
    source: 'Story',
    imagePath: path,
  })),
}
test('question validation rejects client-assigned approval, foreign uploads and malformed options', () => {
  assert.equal(validateQuestion(body, user).options.length, 4)
  assert.throws(() => validateQuestion({ ...body, status: 'approved' }, user))
  assert.throws(() => validateQuestion({ ...body, options: [] }, user))
  assert.throws(() => validateQuestion({ ...body, correct_index: 7 }, user))
  assert.throws(() =>
    validateQuestion(
      {
        ...body,
        options: body.options.map((o) => ({
          ...o,
          imagePath: 'https://evil.invalid/image.png',
        })),
      },
      user,
    ),
  )
  assert.throws(() => validateQuestion(body, { ...user, id: 'another-user' }))
  assert.equal(validImage(Buffer.from('<svg>script</svg>'), 'image/png'), false)
  assert.equal(
    validImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), 'image/png'),
    true,
  )
})
test('server refuses exposing secret or service-role keys through public config', () => {
  assert.equal(createQuizRepository({}), null)
  assert.throws(() =>
    createQuizRepository({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_server',
      SUPABASE_PUBLISHABLE_KEY: 'sb_secret_wrong',
    }),
  )
  const jwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`
  assert.throws(() =>
    createQuizRepository({
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SECRET_KEY: 'secret',
      SUPABASE_PUBLISHABLE_KEY: jwt,
    }),
  )
})
test('HTTP routes enforce auth, ownership and admin checks with a repository test double', async () => {
  let saved = 0
  const repo = {
    publicConfig: {
      url: 'https://example.supabase.co',
      publishableKey: 'public',
    },
    identity: async (token) => {
      if (token === 'member') return user
      if (token === 'admin') return { ...user, isAdmin: true }
      throw new QuizError('Invalid login', 401)
    },
    categories: async () => [{ id: body.category_id, name: 'Test' }],
    list: async () => [],
    get: async () => ({
      ...body,
      id: 'question',
      author_id: 'someone-else',
      revision: 1,
    }),
    save: async (_user, _id, _revision, data) => {
      saved++
      return data
    },
    review: async () => ({ status: 'approved' }),
  }
  const game = createGameServer({ quizRepository: repo })
  await new Promise((resolve) =>
    game.httpServer.listen(0, '127.0.0.1', resolve),
  )
  const base = `http://127.0.0.1:${game.httpServer.address().port}/api/quiz`
  const request = (route, token, data, method = 'POST') =>
    fetch(base + route, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  try {
    assert.equal((await request('/questions', null, null, 'GET')).status, 401)
    assert.equal((await request('/questions', 'fake', null, 'GET')).status, 401)
    assert.equal(
      (await request('/questions?scope=admin', 'member', null, 'GET')).status,
      403,
    )
    assert.equal(
      (
        await request(
          '/questions/question',
          'member',
          { ...body, revision: 1 },
          'PUT',
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request('/questions/question/review', 'member', {
          revision: 1,
          status: 'approved',
        })
      ).status,
      403,
    )
    assert.equal(
      (await request('/questions', 'member', { ...body, status: 'approved' }))
        .status,
      400,
    )
    assert.equal((await request('/questions', 'member', body)).status, 200)
    assert.equal(saved, 1)
    assert.equal(
      (
        await request('/questions/question/review', 'admin', {
          revision: 1,
          status: 'approved',
        })
      ).status,
      200,
    )
  } finally {
    await game.close()
  }
})
