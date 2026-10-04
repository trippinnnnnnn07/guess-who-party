import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// npm workspaces starts the server in server/, so resolve the root explicitly.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })
export const projectRoot = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
)
