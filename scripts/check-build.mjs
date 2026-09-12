import { readdir, readFile } from 'node:fs/promises'
import dotenv from 'dotenv'
const files = await readdir('dist', { recursive: true })
const text = (
  await Promise.all(
    files.filter((f) => /\.(html|js|css|map)$/.test(f)).map((f) => readFile('dist/' + f, 'utf8')),
  )
).join('\n')
let settings = {}
try {
  settings = dotenv.parse(await readFile('.env.server.local'))
} catch {
  /* CI has no backend credentials. */
}
try {
  Object.assign(settings, dotenv.parse(await readFile('.env.google.local')))
} catch {
  /* Google credentials are optional locally and absent from frontend CI. */
}
for (const name of [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'GOOGLE_CLIENT_SECRET',
]) {
  if (settings[name] && text.includes(settings[name]))
    throw new Error(`Backend credential leaked into the build: ${name}`)
}
if (/sb_secret_[A-Za-z0-9_-]{15,}/.test(text))
  throw new Error('Secret key detected in frontend output')
if (!text.includes('agape.auth'))
  throw new Error('Agape-specific auth storage configuration missing')
console.log('Build checked: no backend credentials in frontend assets.')
