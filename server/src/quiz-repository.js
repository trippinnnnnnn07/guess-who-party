import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export class QuizError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

export function unwrap({ data, error }) {
  if (error) {
    const messages = {
      CONFLICT: 'โจทย์ถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนบันทึก',
      FORBIDDEN: 'ไม่มีสิทธิ์ดำเนินการ',
      NOT_FOUND: 'ไม่พบโจทย์นี้',
      NOT_PENDING: 'ต้องส่งตรวจโจทย์ก่อนอนุมัติ',
    }
    if (messages[error.message])
      throw new QuizError(
        messages[error.message],
        error.message === 'CONFLICT' ? 409 : 400,
      )
    // Never expose connection strings, SQL, tokens, or raw provider errors.
    throw new QuizError(
      'เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาตรวจการตั้งค่า Supabase และไฟล์ migration',
      503,
    )
  }
  return data
}

function unwrapRow(result) {
  const data = unwrap(result)
  // PostgREST may represent composite return values as a one-row array.
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.id) throw new QuizError('บันทึกข้อมูลไม่สำเร็จ กรุณาโหลดใหม่', 503)
  return row
}

export function createQuizRepository(env = process.env) {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key || !publishableKey) return null
  // Avoid accidental disclosure if a server key is placed in the public setting.
  let legacyRole
  try {
    legacyRole = JSON.parse(
      Buffer.from(publishableKey.split('.')[1] || '', 'base64url').toString(),
    ).role
  } catch {}
  if (
    publishableKey.startsWith('sb_secret_') ||
    legacyRole === 'service_role' ||
    publishableKey === key
  )
    throw new Error(
      'SUPABASE_PUBLISHABLE_KEY must be a publishable/anon key, never a secret key',
    )
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init = {}) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(12_000) }),
    },
  })
  const bucket = client.storage.from('quiz-images')
  let authStatusCache = null
  const repo = {
    publicConfig: { url, publishableKey },
    async authStatus() {
      if (authStatusCache && authStatusCache.until > Date.now())
        return authStatusCache.enabled
      try {
        const response = await fetch(`${url}/auth/v1/settings`, {
          headers: { apikey: publishableKey },
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok) return null
        const enabled = (await response.json()).external?.google === true
        authStatusCache = { enabled, until: Date.now() + 30_000 }
        return enabled
      } catch {
        return null
      }
    },
    async identity(token) {
      const { data, error } = await client.auth.getUser(token)
      if (
        error ||
        !data.user ||
        !data.user.identities?.some((i) => i.provider === 'google')
      )
        throw new QuizError('กรุณาเข้าสู่ระบบด้วย Google ใหม่', 401)
      const user = data.user
      const admin = unwrap(
        await client
          .from('quiz_admins')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle(),
      )
      return {
        id: user.id,
        name: String(user.user_metadata?.full_name || 'สมาชิก').slice(0, 80),
        isAdmin: Boolean(admin),
      }
    },
    async categories() {
      return unwrap(
        await client
          .from('quiz_categories')
          .select('*')
          .eq('active', true)
          .order('name'),
      )
    },
    async addCategory(name) {
      return unwrap(
        await client.from('quiz_categories').insert({ name }).select().single(),
      )
    },
    async imageUrl(imagePath, seconds = 86_400) {
      if (
        ['builtin/fire.svg', 'builtin/ice.svg', 'builtin/earth.svg'].includes(
          imagePath,
        )
      )
        return `/quiz-samples/${imagePath.slice(8)}`
      return unwrap(await bucket.createSignedUrl(imagePath, seconds)).signedUrl
    },
    async hydrate(question) {
      return {
        ...question,
        options: await Promise.all(
          question.options.map(async (option) => ({
            ...option,
            imageUrl: await repo.imageUrl(option.imagePath),
          })),
        ),
      }
    },
    async list(user, scope, offset) {
      let query = client
        .from('quiz_questions')
        .select('*')
        .neq('status', 'deleted')
        .order('updated_at', { ascending: false })
        .range(offset, offset + 19)
      if (!(scope === 'admin' && user.isAdmin))
        query = query.eq('author_id', user.id)
      return Promise.all(unwrap(await query).map((q) => repo.hydrate(q)))
    },
    async get(id) {
      return unwrap(
        await client
          .from('quiz_questions')
          .select('*')
          .eq('id', id)
          .maybeSingle(),
      )
    },
    async save(user, id, revision, data) {
      return repo.hydrate(
        unwrapRow(
          await client.rpc('quiz_save_question', {
            p_actor: user.id,
            p_id: id,
            p_revision: revision,
            p_data: data,
          }),
        ),
      )
    },
    async review(user, id, revision, status, note) {
      return repo.hydrate(
        unwrapRow(
          await client.rpc('quiz_review_question', {
            p_actor: user.id,
            p_id: id,
            p_revision: revision,
            p_status: status,
            p_note: note,
          }),
        ),
      )
    },
    async history(id) {
      return unwrap(
        await client
          .from('quiz_reviews')
          .select('*')
          .eq('question_id', id)
          .order('created_at', { ascending: false })
          .limit(50),
      )
    },
    async pick(settings, authorIds) {
      const questions = unwrap(
        await client.rpc('quiz_pick_questions', {
          p_categories: settings.categoryIds,
          p_excluded_authors: authorIds,
          p_count: settings.questionCount,
        }),
      )
      return Promise.all(questions.map((q) => repo.hydrate(q)))
    },
    async upload(user, bytes, mime) {
      const extension = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
      }[mime]
      const imagePath = `${user.id}/${randomUUID()}.${extension}`
      unwrap(
        await bucket.upload(imagePath, bytes, {
          contentType: mime,
          upsert: false,
        }),
      )
      return { imagePath, imageUrl: await repo.imageUrl(imagePath) }
    },
  }
  return repo
}
