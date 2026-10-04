import { useEffect, useState } from 'react'
import { getAuthClient, quizApi, quizConfig } from './quiz-client.js'

export function useQuizAccount(onError) {
  const [config, setConfig] = useState(null)
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [categories, setCategories] = useState([])
  useEffect(() => {
    let alive = true
    let subscription
    async function init() {
      const cfg = await quizConfig()
      if (!alive) return
      setConfig(cfg)
      const auth = await getAuthClient()
      if (auth) {
        subscription = auth.auth.onAuthStateChange((_event, value) => {
          if (alive) setSession(value)
        }).data.subscription
        const { data } = await auth.auth.getSession()
        if (alive) setSession(data.session)
      }
      const values = await quizApi('/categories')
      if (alive) setCategories(values)
    }
    init().catch((e) => {
      if (alive) onError(e.message)
    })
    return () => {
      alive = false
      subscription?.unsubscribe()
    }
  }, [])
  useEffect(() => {
    let alive = true
    setUser(null)
    if (session)
      quizApi('/me')
        .then((value) => {
          if (alive) setUser(value)
        })
        .catch((e) => {
          if (alive) onError(e.message)
        })
    return () => {
      alive = false
    }
  }, [session?.access_token])
  async function login() {
    try {
      const client = await getAuthClient()
      if (!client)
        throw new Error('ยังไม่ได้ตั้งค่า Supabase ดูขั้นตอนใน README')
      if (config?.googleEnabled === false)
        throw new Error(
          'ยังไม่ได้เปิด Google Login ใน Supabase ดูคู่มือ docs/SUPABASE_SETUP.md แล้วรีเฟรชหน้านี้หลังตั้งค่า',
        )
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
    } catch (e) {
      onError(e.message)
    }
  }
  async function logout() {
    try {
      const { error } = await (await getAuthClient()).auth.signOut()
      if (error) throw error
    } catch (e) {
      onError(e.message)
    }
  }
  return { config, session, user, categories, setCategories, login, logout }
}

export default function QuizAccount({ account, onBank }) {
  return (
    <div className="quiz-account">
      <button type="button" className="ghost-button" onClick={onBank}>
        คลังโจทย์ / สร้างโจทย์
      </button>
      {account.user ? (
        <>
          <span>
            {account.user.name}
            {account.user.isAdmin ? ' · แอดมิน' : ''}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={account.logout}
          >
            ออกจากบัญชี
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ghost-button"
          disabled={!account.config?.configured}
          onClick={account.login}
        >
          {account.config?.googleEnabled === false
            ? 'Google Login · รอตั้งค่า'
            : 'เข้าสู่ระบบด้วย Google'}
        </button>
      )}
    </div>
  )
}
