import '../src/env.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createQuizRepository } from '../src/quiz-repository.js'

// Explicit integration check: creates only its own tiny image, then removes it.
// No credentials, signed URLs, or user data are logged.
const repo = createQuizRepository()
if (!repo) throw new Error('Configure Supabase in .env first')
const server = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
const fixtureId = randomUUID()
const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVNoAAAAASUVORK5CYII=',
  'base64',
)
let uploaded
try {
  uploaded = await repo.upload({ id: fixtureId }, bytes, 'image/png')
  assert.ok(uploaded.imagePath.startsWith(`${fixtureId}/`))
  const signed = await fetch(uploaded.imageUrl)
  assert.equal(signed.status, 200)
  assert.deepEqual(Buffer.from(await signed.arrayBuffer()), bytes)
  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/quiz-images/${uploaded.imagePath}`
  assert.notEqual((await fetch(publicUrl)).status, 200)
  const anon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error } = await anon.from('quiz_questions').select('*').limit(1)
  assert.ok(error, 'Anonymous clients must not read the question bank')
  const rpc = await anon.rpc('quiz_pick_questions', {
    p_categories: [],
    p_excluded_authors: [],
    p_count: 1,
  })
  assert.ok(rpc.error, 'Anonymous clients must not call the answer-bearing RPC')
  console.log(
    'PASS: real upload, signed image download, private bucket and anonymous table/RPC denial.',
  )
} finally {
  if (uploaded && uploaded.imagePath.startsWith(`${fixtureId}/`)) {
    const { error } = await server.storage
      .from('quiz-images')
      .remove([uploaded.imagePath])
    if (error)
      throw new Error(
        'Could not remove this test image; inspect the test-only Storage folder.',
      )
    console.log('Removed the test-only image; no member images were changed.')
  }
}
