import { readFile, chmod } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import dotenv from 'dotenv'

// Credentials stay in memory and are never included in command arguments or logs.
const google = dotenv.parse(await readFile('.env.google.local'))
const browser = dotenv.parse(await readFile('.env.local'))
if (
  !google.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') ||
  !google.GOOGLE_CLIENT_SECRET
) {
  throw new Error('The local Google OAuth credential file is incomplete.')
}
await chmod('.env.google.local', 0o600)
const project = new URL(browser.VITE_SUPABASE_URL).hostname.split('.')[0]
let token = process.env.SUPABASE_ACCESS_TOKEN
if (!token && process.platform === 'darwin') {
  for (const account of ['supabase', 'access-token']) {
    try {
      token = execFileSync(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'Supabase CLI', '-a', account, '-w'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ).trim()
      // Match go-keyring's macOS serialization used by the Supabase CLI.
      if (token.startsWith('go-keyring-base64:'))
        token = Buffer.from(token.slice('go-keyring-base64:'.length), 'base64').toString('utf8')
      else if (token.startsWith('go-keyring-encoded:'))
        token = Buffer.from(token.slice('go-keyring-encoded:'.length), 'hex').toString('utf8')
      if (token) break
    } catch {
      /* Try the documented legacy key and token-file fallback. */
    }
  }
}
if (!token) {
  try {
    token = (await readFile(`${homedir()}/.supabase/access-token`, 'utf8')).trim()
  } catch {
    /* Report only the missing sign-in. */
  }
}
if (!token) throw new Error('Supabase CLI sign-in is unavailable. Run supabase login first.')

const endpoint = `https://api.supabase.com/v1/projects/${project}/config/auth`
async function authConfig(method = 'GET', values) {
  const response = await fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(values ? { body: JSON.stringify(values) } : {}),
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok)
    throw new Error(`Supabase Auth configuration request failed (HTTP ${response.status}).`)
  return response.json()
}
try {
  const before = await authConfig()
  if (
    before.external_google_enabled &&
    before.external_google_client_id !== google.GOOGLE_CLIENT_ID
  ) {
    throw new Error(
      'A different Google client is already enabled. Refusing to replace it automatically.',
    )
  }
  if (before.uri_allow_list != null && typeof before.uri_allow_list !== 'string') {
    throw new Error('Unexpected redirect allowlist format; no settings changed.')
  }
  const previous = (before.uri_allow_list || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const redirects = [...new Set([...previous, 'http://127.0.0.1:5173/', 'http://localhost:5173/'])]
  await authConfig('PATCH', {
    external_google_enabled: true,
    external_google_client_id: google.GOOGLE_CLIENT_ID,
    external_google_secret: google.GOOGLE_CLIENT_SECRET,
    uri_allow_list: redirects.join(','),
  })
  const after = await authConfig()
  const finalRedirects = (after.uri_allow_list || '').split(',').map((s) => s.trim())
  if (
    !after.external_google_enabled ||
    after.external_google_client_id !== google.GOOGLE_CLIENT_ID ||
    !redirects.every((url) => finalRedirects.includes(url)) ||
    before.site_url !== after.site_url
  ) {
    throw new Error(
      'Auth settings were updated but verification did not match expectations. Inspect Supabase settings.',
    )
  }
  console.log('Google provider enabled with the supplied OAuth client.')
  console.log(
    'Both local Agape redirect URLs are allowed; existing redirects and Site URL are preserved.',
  )

  const authorize = new URL('/auth/v1/authorize', browser.VITE_SUPABASE_URL)
  authorize.searchParams.set('provider', 'google')
  authorize.searchParams.set('redirect_to', 'http://127.0.0.1:5173/')
  authorize.searchParams.set('scopes', 'https://www.googleapis.com/auth/youtube.readonly')
  authorize.searchParams.set(
    'code_challenge',
    createHash('sha256').update(randomBytes(32)).digest('base64url'),
  )
  authorize.searchParams.set('code_challenge_method', 's256')
  const response = await fetch(authorize, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  const location = response.headers.get('location')
  if (response.status !== 302 || !location)
    throw new Error('Provider is saved; the Google authorization redirect is not ready yet.')
  const target = new URL(location)
  if (
    target.hostname !== 'accounts.google.com' ||
    target.searchParams.get('client_id') !== google.GOOGLE_CLIENT_ID ||
    target.searchParams.get('redirect_uri') !== `${browser.VITE_SUPABASE_URL}/auth/v1/callback` ||
    !target.searchParams.get('scope')?.includes('youtube.readonly')
  ) {
    throw new Error(
      'Google authorization redirect did not contain the expected Agape configuration.',
    )
  }
  console.log(
    'Authorization endpoint verified: Google redirect, configured client, Supabase callback, and YouTube read scope.',
  )
  console.log('A real Google sign-in is still required to verify consent and token exchange.')
} catch (error) {
  // Deliberately omit response bodies and stacks: management responses can contain secrets.
  console.error(error instanceof Error ? error.message : 'Google configuration failed.')
  process.exitCode = 1
}
