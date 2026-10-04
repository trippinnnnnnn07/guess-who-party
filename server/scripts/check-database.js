import '../src/env.js'
import { createQuizRepository } from '../src/quiz-repository.js'

try {
  const repo = createQuizRepository()
  if (!repo)
    throw new Error(
      'Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY or SUPABASE_SECRET_KEY in the project root .env',
    )
  const categories = await repo.categories()
  const sample = await repo.pick({ categoryIds: [], questionCount: 1 }, [])
  console.log(
    `Database connected. Active categories: ${categories.length}. Approved sample question available: ${sample.length > 0}.`,
  )
  console.log(
    'This read-only check does not verify Google OAuth or create any users.',
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
