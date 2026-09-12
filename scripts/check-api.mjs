import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true })
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Browser configuration is missing')
for (const [name, path, options] of [
  [
    'Ontology navigation',
    '/rest/v1/rpc/browse',
    {
      method: 'POST',
      headers: { 'Content-Profile': 'agape', 'Content-Type': 'application/json' },
      body: '{}',
    },
  ],
  ['Google sign-in configuration', '/auth/v1/settings', {}],
  [
    'Verification function authentication',
    '/functions/v1/agape-verify-video',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  ],
  [
    'Verification function invalid token',
    '/functions/v1/agape-verify-video',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-test-token' },
      body: '{}',
    },
  ],
]) {
  try {
    const response = await fetch(url + path, {
      ...options,
      headers: { apikey: key, ...options.headers },
      signal: AbortSignal.timeout(15000),
    })
    const body = await response.json()
    if (name === 'Ontology navigation' && response.ok)
      console.log(name + ': OK; independent roots = ' + body.topics.length)
    else if (name === 'Google sign-in configuration' && response.ok) {
      console.log(name + ': ' + (body.external?.google ? 'enabled' : 'not enabled'))
      if (!body.external?.google) process.exitCode = 1
    } else if (name.startsWith('Verification function') && response.status === 401)
      console.log(name + ': OK; unauthorized request rejected')
    else {
      console.log(
        name +
          ': HTTP ' +
          response.status +
          ' ' +
          (body.code || '') +
          ' ' +
          (body.error || body.message || ''),
      )
      process.exitCode = 1
    }
  } catch {
    console.log(name + ': could not connect')
    process.exitCode = 1
  }
}
