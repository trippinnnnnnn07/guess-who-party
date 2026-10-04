import { useEffect, useState } from 'react'
import { quizApi } from './quiz-client.js'

const statusName = {
  draft: 'ฉบับร่าง',
  pending: 'รอตรวจ',
  approved: 'อนุมัติแล้ว',
  changes_requested: 'ให้แก้ไข',
  hidden: 'ซ่อน',
  deleted: 'ลบแล้ว',
}
const blank = (categoryId) => ({
  title: 'ใครต่างจากเพื่อน?',
  category_id: categoryId || '',
  options: Array.from({ length: 4 }, () => ({
    name: '',
    source: '',
    imagePath: '',
    imageUrl: '',
  })),
  correct_index: 0,
  hint: '',
  explanation: '',
  status: 'draft',
})

function Editor({ initial, categories, onSaved, onClose, onError }) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setOption = (index, values) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((o, i) => (i === index ? { ...o, ...values } : o)),
    }))
  async function upload(index, file) {
    if (!file) return
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 3 * 1024 * 1024
    )
      return onError('เลือกรูป PNG, JPG หรือ WEBP ไม่เกิน 3 MB')
    setBusy(true)
    try {
      setOption(index, await quizApi('/images', { method: 'POST', file }))
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }
  async function save(event) {
    event.preventDefault()
    const status = event.nativeEvent.submitter?.value || 'draft'
    setBusy(true)
    try {
      await quizApi(form.id ? `/questions/${form.id}` : '/questions', {
        method: form.id ? 'PUT' : 'POST',
        body: { ...form, status },
      })
      onSaved()
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel bank-editor">
      <div className="section-heading">
        <h2>{form.id ? 'แก้ไขโจทย์' : 'สร้างโจทย์ใหม่'}</h2>
        <button className="ghost-button" onClick={onClose} disabled={busy}>
          ยกเลิก
        </button>
      </div>
      <p className="helper-copy">
        โจทย์ที่แก้ไขต้องส่งตรวจใหม่ก่อนกลับเข้าคลังสุ่ม
        กรุณาใช้รูปที่คุณมีสิทธิ์ใช้งาน
      </p>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label htmlFor="question-title">หัวข้อ</label>
          <input
            id="question-title"
            required
            maxLength={160}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <label htmlFor="question-category">หมวดหมู่</label>
          <select
            id="question-category"
            required
            value={form.category_id}
            onChange={(e) => set('category_id', e.target.value)}
          >
            <option value="">เลือกหมวดหมู่</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="bank-edit-options">
            {form.options.map((option, index) => (
              <section className="bank-option" key={index}>
                <h3>ตัวเลือก {index + 1}</h3>
                {option.imageUrl && (
                  <img src={option.imageUrl} alt={`ตัวอย่าง ${index + 1}`} />
                )}
                <label htmlFor={`q-image-${index}`}>รูปภาพ</label>
                <input
                  id={`q-image-${index}`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => upload(index, e.target.files?.[0])}
                />
                <label htmlFor={`q-name-${index}`}>ชื่อบุคคล / ตัวละคร</label>
                <input
                  id={`q-name-${index}`}
                  required
                  maxLength={80}
                  value={option.name}
                  onChange={(e) => setOption(index, { name: e.target.value })}
                />
                <label htmlFor={`q-source-${index}`}>
                  เรื่อง / ทีม / แหล่งที่มา
                </label>
                <input
                  id={`q-source-${index}`}
                  required
                  maxLength={120}
                  value={option.source}
                  onChange={(e) => setOption(index, { source: e.target.value })}
                />
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="correct-answer"
                    checked={form.correct_index === index}
                    onChange={() => set('correct_index', index)}
                  />{' '}
                  คนนี้ต่างจากเพื่อน (เฉลย)
                </label>
              </section>
            ))}
          </div>
          <label htmlFor="question-hint">คำใบ้ / คีย์เวิร์ดความแตกต่าง</label>
          <input
            id="question-hint"
            required
            maxLength={100}
            value={form.hint}
            onChange={(e) => set('hint', e.target.value)}
            placeholder="เช่น พลังไฟ"
          />
          <label htmlFor="question-explanation">เหตุผลเฉลย</label>
          <textarea
            id="question-explanation"
            required
            maxLength={1000}
            value={form.explanation}
            onChange={(e) => set('explanation', e.target.value)}
            placeholder="อธิบายว่าทำไมตัวนี้ต่างจากอีกสามตัว"
          />
          <div className="bank-actions">
            <button className="secondary-button" type="submit" value="draft">
              บันทึกฉบับร่าง
            </button>
            <button className="primary-button" type="submit" value="pending">
              ส่งให้แอดมินตรวจ
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}

function Review({ question, onDone, onError }) {
  const [note, setNote] = useState(question.review_note || '')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(null)
  async function review(status) {
    if (
      status === 'deleted' &&
      !window.confirm('ลบโจทย์นี้ออกจากคลัง? ระบบเก็บประวัติการตรวจไว้')
    )
      return
    setBusy(true)
    try {
      await quizApi(`/questions/${question.id}/review`, {
        method: 'POST',
        body: { revision: question.revision, status, note },
      })
      onDone()
    } catch (e) {
      onError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bank-review">
      <label htmlFor={`review-${question.id}`}>เหตุผล / หมายเหตุการตรวจ</label>
      <textarea
        id={`review-${question.id}`}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="bank-review-actions">
        <button
          disabled={busy || question.status !== 'pending'}
          onClick={() => review('approved')}
        >
          อนุมัติ
        </button>
        <button
          disabled={busy || !note.trim()}
          onClick={() => review('changes_requested')}
        >
          ให้แก้ไข
        </button>
        <button disabled={busy} onClick={() => review('hidden')}>
          ซ่อน
        </button>
        <button disabled={busy} onClick={() => review('deleted')}>
          ลบ
        </button>
        <button
          onClick={async () => {
            try {
              setHistory(await quizApi(`/questions/${question.id}/history`))
            } catch (e) {
              onError(e.message)
            }
          }}
        >
          ประวัติ
        </button>
      </div>
      {history && (
        <ul>
          {history.map((entry) => (
            <li key={entry.id}>
              {new Date(entry.created_at).toLocaleString('th-TH')} ·{' '}
              {entry.action} · {entry.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function QuestionBank({ account, onBack, onError }) {
  const [scope, setScope] = useState('mine')
  const [questions, setQuestions] = useState([])
  const [offset, setOffset] = useState(0)
  const [editor, setEditor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [categoryName, setCategoryName] = useState('')
  const reload = () => setRevision((v) => v + 1)
  useEffect(() => {
    setQuestions([])
    setEditor(null)
    setOffset(0)
    setScope('mine')
  }, [account.user?.id])
  useEffect(() => {
    if (!account.user) return
    let alive = true
    setLoading(true)
    quizApi(`/questions?scope=${scope}&offset=${offset}`)
      .then((data) => {
        if (alive) setQuestions(data)
      })
      .catch((e) => {
        if (alive) onError(e.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [account.user?.id, scope, offset, revision])
  async function addCategory(event) {
    event.preventDefault()
    try {
      await quizApi('/categories', {
        method: 'POST',
        body: { name: categoryName },
      })
      account.setCategories(await quizApi('/categories'))
      setCategoryName('')
    } catch (e) {
      onError(e.message)
    }
  }
  return (
    <main className="page-shell quiz-page bank-page">
      <button className="ghost-button" onClick={onBack}>
        ← กลับหน้าเกม
      </button>
      <div className="quiz-heading">
        <div>
          <span className="eyebrow">คลังโจทย์ · ใครต่างจากเพื่อน</span>
          <h1>แบ่งปันโจทย์ให้เพื่อนเล่น</h1>
        </div>
      </div>
      {!account.config?.configured ? (
        <section className="panel">
          <h2>ยังไม่ได้เชื่อมต่อ Supabase</h2>
          <p>
            ตั้งค่าฐานข้อมูลและ Google Login ตาม README ก่อน
            จึงจะสร้างและบันทึกโจทย์ออนไลน์ได้
          </p>
        </section>
      ) : !account.user ? (
        <section className="panel">
          <h2>เข้าสู่ระบบก่อนสร้างโจทย์</h2>
          <p>เล่นเกมได้โดยไม่ต้องล็อกอิน แต่การสร้างโจทย์ต้องมีบัญชี Google</p>
          <button className="primary-button" onClick={account.login}>
            เข้าสู่ระบบด้วย Google
          </button>
        </section>
      ) : (
        <>
          <div className="bank-toolbar">
            <button
              className={scope === 'mine' ? 'active' : ''}
              onClick={() => {
                setScope('mine')
                setOffset(0)
              }}
            >
              โจทย์ของฉัน
            </button>
            {account.user.isAdmin && (
              <button
                className={scope === 'admin' ? 'active' : ''}
                onClick={() => {
                  setScope('admin')
                  setOffset(0)
                }}
              >
                แอดมิน · ตรวจโจทย์ทั้งหมด
              </button>
            )}
            <button onClick={() => setEditor(blank(account.categories[0]?.id))}>
              + สร้างโจทย์
            </button>
            <button onClick={reload}>โหลดใหม่</button>
          </div>
          {scope === 'admin' && (
            <form className="bank-category" onSubmit={addCategory}>
              <label htmlFor="new-category">เพิ่มหมวดหมู่</label>
              <input
                id="new-category"
                required
                maxLength={60}
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="ชื่อหมวดหมู่ใหม่"
              />
              <button className="secondary-button">เพิ่ม</button>
            </form>
          )}
          {editor ? (
            <Editor
              key={editor.id || 'new'}
              initial={editor}
              categories={account.categories}
              onClose={() => setEditor(null)}
              onError={onError}
              onSaved={() => {
                setEditor(null)
                reload()
              }}
            />
          ) : loading ? (
            <p role="status">กำลังโหลดโจทย์...</p>
          ) : (
            <>
              <p className="helper-copy">
                แสดงเฉพาะโจทย์ของคุณ หรือโจทย์ที่คุณมีสิทธิ์ตรวจ
                คลังเฉลยไม่เปิดให้ผู้เล่นทั่วไปอ่าน
              </p>
              {questions.length === 0 && (
                <section className="panel">
                  <h2>ยังไม่มีโจทย์ในหน้านี้</h2>
                  <p>เริ่มจากสร้างโจทย์แรก แล้วส่งให้แอดมินตรวจได้เลย</p>
                </section>
              )}
              {questions.map((q) => (
                <article
                  className="panel bank-question"
                  key={`${q.id}-${q.revision}`}
                >
                  <div className="section-heading">
                    <h2>{q.title}</h2>
                    <span className={`bank-status bank-status--${q.status}`}>
                      {statusName[q.status]}
                    </span>
                  </div>
                  <p>
                    {
                      account.categories.find((c) => c.id === q.category_id)
                        ?.name
                    }{' '}
                    · ฉบับที่ {q.revision}
                  </p>
                  <div className="bank-preview-options">
                    {q.options.map((o, i) => (
                      <div key={i}>
                        <img src={o.imageUrl} alt={o.name} />
                        <strong>
                          {o.name}
                          {i === q.correct_index ? ' ✓' : ''}
                        </strong>
                        <small>{o.source}</small>
                      </div>
                    ))}
                  </div>
                  <p>
                    <b>คำใบ้:</b> {q.hint}
                  </p>
                  <p>
                    <b>เหตุผล:</b> {q.explanation}
                  </p>
                  {q.review_note && (
                    <p className="quiz-notice">หมายเหตุ: {q.review_note}</p>
                  )}
                  <button
                    className="secondary-button"
                    onClick={() => setEditor(q)}
                  >
                    แก้ไข / ส่งตรวจใหม่
                  </button>
                  {scope === 'admin' && (
                    <Review question={q} onDone={reload} onError={onError} />
                  )}
                </article>
              ))}
              <div className="bank-toolbar">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  หน้าก่อน
                </button>
                <span>หน้า {Math.floor(offset / 20) + 1}</span>
                <button
                  disabled={questions.length < 20}
                  onClick={() => setOffset(offset + 20)}
                >
                  หน้าถัดไป
                </button>
              </div>
            </>
          )}
        </>
      )}
    </main>
  )
}
