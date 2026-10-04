import express from 'express'
import { QuizError } from './quiz-repository.js'

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new QuizError(`${label} ต้องมี 1–${max} ตัวอักษร`)
  return value.trim()
}

export function validateQuestion(body, user, existing) {
  if (!['draft', 'pending'].includes(body.status))
    throw new QuizError('สถานะไม่ถูกต้อง')
  if (!Array.isArray(body.options) || body.options.length !== 4)
    throw new QuizError('ต้องมี 4 ตัวเลือก')
  if (
    !Number.isInteger(body.correct_index) ||
    body.correct_index < 0 ||
    body.correct_index > 3
  )
    throw new QuizError('เลือกเฉลย 1 ใน 4 ตัวเลือก')
  const options = body.options.map((o) => {
    const imagePath = String(o?.imagePath || '')
    const owns = imagePath.startsWith(`${user.id}/`)
    const previouslyUsed = existing?.options.some(
      (old) => old.imagePath === imagePath,
    )
    const validPath = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(
      imagePath,
    )
    const builtin =
      previouslyUsed &&
      ['builtin/fire.svg', 'builtin/ice.svg', 'builtin/earth.svg'].includes(
        imagePath,
      )
    if ((!validPath && !builtin) || (!owns && !previouslyUsed))
      throw new QuizError('กรุณาอัปโหลดรูปของคุณสำหรับแต่ละตัวเลือก')
    return {
      name: text(o.name, 80, 'ชื่อ'),
      source: text(o.source, 120, 'เรื่อง/ทีม'),
      imagePath,
    }
  })
  return {
    title: text(body.title, 160, 'หัวข้อ'),
    category_id: text(body.category_id, 36, 'หมวดหมู่'),
    options,
    correct_index: body.correct_index,
    hint: text(body.hint, 100, 'คำใบ้'),
    explanation: text(body.explanation, 1000, 'เหตุผลเฉลย'),
    status: body.status,
  }
}

export function validImage(bytes, mime) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 3 * 1024 * 1024
  )
    return false
  if (mime === 'image/png')
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/webp')
    return (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
  return false
}

export function mountQuizApi(app, repository, demo) {
  const router = express.Router()
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next)
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  router.get(
    '/config',
    wrap(async (_req, res) =>
      res.json({
        configured: Boolean(repository),
        googleEnabled: (await repository?.authStatus?.()) ?? null,
        demo: Boolean(demo),
        ...(repository?.publicConfig || {}),
      }),
    ),
  )
  router.get(
    '/categories',
    wrap(async (_req, res) =>
      res.json(
        repository
          ? await repository.categories()
          : demo
            ? demo.categories
            : [],
      ),
    ),
  )
  router.use((req, res, next) => {
    if (!repository)
      return next(new QuizError('ยังไม่ได้เชื่อมต่อ Supabase', 503))
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
    if (!token || token.length > 8192)
      return next(new QuizError('กรุณาเข้าสู่ระบบด้วย Google', 401))
    repository
      .identity(token)
      .then((user) => {
        req.user = user
        next()
      })
      .catch(next)
  })
  const rates = new Map()
  router.use((req, res, next) => {
    if (req.method === 'GET') return next()
    const now = Date.now()
    for (const [id, value] of rates) if (value.until < now) rates.delete(id)
    const rate = rates.get(req.user.id) || { count: 0, until: now + 60_000 }
    rates.set(req.user.id, rate)
    if (++rate.count > 40)
      return next(new QuizError('ส่งข้อมูลถี่เกินไป กรุณารอ 1 นาที', 429))
    next()
  })
  router.get('/me', (req, res) => res.json(req.user))
  router.post(
    '/images',
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp'],
      limit: '3mb',
    }),
    wrap(async (req, res) => {
      const mime = req.headers['content-type']?.split(';')[0]
      if (!validImage(req.body, mime))
        throw new QuizError(
          'รูปต้องเป็น PNG, JPG หรือ WEBP จริง ขนาดไม่เกิน 3 MB',
        )
      res.status(201).json(await repository.upload(req.user, req.body, mime))
    }),
  )
  router.use(express.json({ limit: '64kb' }))
  router.get(
    '/questions',
    wrap(async (req, res) => {
      if (req.query.scope === 'admin' && !req.user.isAdmin)
        throw new QuizError('เฉพาะแอดมินเท่านั้น', 403)
      const offset = Math.min(
        100000,
        Math.max(0, Number.parseInt(req.query.offset, 10) || 0),
      )
      res.json(await repository.list(req.user, req.query.scope, offset))
    }),
  )
  const save = wrap(async (req, res) => {
    const existing = req.params.id ? await repository.get(req.params.id) : null
    if (req.params.id && (!existing || existing.status === 'deleted'))
      throw new QuizError('ไม่พบโจทย์', 404)
    if (existing && existing.author_id !== req.user.id && !req.user.isAdmin)
      throw new QuizError('แก้ไขได้เฉพาะโจทย์ของตัวเอง', 403)
    if (existing && !Number.isInteger(req.body.revision))
      throw new QuizError('กรุณาโหลดโจทย์ใหม่')
    const data = validateQuestion(req.body, req.user, existing)
    if (!(await repository.categories()).some((c) => c.id === data.category_id))
      throw new QuizError('ไม่พบหมวดหมู่นี้')
    res.json(
      await repository.save(
        req.user,
        existing?.id ?? null,
        req.body.revision ?? null,
        data,
      ),
    )
  })
  router.post('/questions', save)
  router.put('/questions/:id', save)
  router.post(
    '/questions/:id/review',
    wrap(async (req, res) => {
      if (!req.user.isAdmin) throw new QuizError('เฉพาะแอดมินเท่านั้น', 403)
      if (
        !Number.isInteger(req.body.revision) ||
        !['approved', 'changes_requested', 'hidden', 'deleted'].includes(
          req.body.status,
        )
      )
        throw new QuizError('ข้อมูลการตรวจไม่ถูกต้อง')
      const note = String(req.body.note ?? '').trim()
      if (
        note.length > 1000 ||
        (req.body.status === 'changes_requested' && !note)
      )
        throw new QuizError('กรุณาระบุเหตุผลไม่เกิน 1,000 ตัวอักษร')
      res.json(
        await repository.review(
          req.user,
          req.params.id,
          req.body.revision,
          req.body.status,
          note,
        ),
      )
    }),
  )
  router.get(
    '/questions/:id/history',
    wrap(async (req, res) => {
      const q = await repository.get(req.params.id)
      if (!q || (q.author_id !== req.user.id && !req.user.isAdmin))
        throw new QuizError('ไม่มีสิทธิ์ดูข้อมูลนี้', 403)
      res.json(await repository.history(q.id))
    }),
  )
  router.post(
    '/categories',
    wrap(async (req, res) => {
      if (!req.user.isAdmin) throw new QuizError('เฉพาะแอดมินเท่านั้น', 403)
      res
        .status(201)
        .json(await repository.addCategory(text(req.body.name, 60, 'หมวดหมู่')))
    }),
  )
  router.use((error, _req, res, _next) => {
    const status =
      error instanceof QuizError
        ? error.status
        : error.type === 'entity.too.large'
          ? 413
          : 500
    res
      .status(status)
      .json({
        error:
          error instanceof QuizError
            ? error.message
            : status === 413
              ? 'ข้อมูลมีขนาดใหญ่เกินไป'
              : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่',
      })
  })
  app.use('/api/quiz', router)
}
