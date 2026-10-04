import { createClient } from '@supabase/supabase-js'

const base = import.meta.env.VITE_SERVER_URL || ''
let configPromise
let authClient
export async function quizConfig() {
  if (!configPromise)
    configPromise = fetch(`${base}/api/quiz/config`)
      .then(async (r) => {
        if (!r.ok) throw new Error('โหลดการตั้งค่าไม่สำเร็จ')
        const config = await r.json()
        if (config.configured)
          authClient = createClient(config.url, config.publishableKey, {
            auth: { flowType: 'pkce' },
          })
        return config
      })
      .catch((error) => {
        configPromise = null
        throw error
      })
  return configPromise
}
export async function getAuthClient() {
  await quizConfig()
  return authClient
}
export async function accessToken() {
  const client = await getAuthClient()
  return (await client?.auth.getSession())?.data.session?.access_token
}
export async function quizApi(route, { method = 'GET', body, file } = {}) {
  const token = await accessToken()
  const response = await fetch(`${base}/api/quiz${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(file
        ? { 'Content-Type': file.type }
        : body
          ? { 'Content-Type': 'application/json' }
          : {}),
    },
    body: file || (body ? JSON.stringify(body) : undefined),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'ดำเนินการไม่สำเร็จ')
  return data
}
