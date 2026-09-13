import { handleRequest } from './handler.ts'

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message)
}
const token = '22222222-2222-4222-8222-222222222222'

async function scenario(
  known: boolean,
  test: (calls: { url: string; body: Record<string, unknown> | null }[]) => Promise<void>,
) {
  Deno.env.set('SUPABASE_URL', 'https://agape-test.invalid')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-server-key')
  const originalFetch = globalThis.fetch
  const calls: { url: string; body: Record<string, unknown> | null }[] = []
  globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
    return Promise.resolve(
      new Response(JSON.stringify(known), { headers: { 'Content-Type': 'application/json' } }),
    )
  }
  try {
    await test(calls)
  } finally {
    globalThis.fetch = originalFetch
  }
}
const request = (method: string, query = `?token=${token}`) =>
  new Request(`https://functions.invalid/agape-unsubscribe${query}`, { method })

Deno.test('answers preflight and rejects other methods', async () => {
  await scenario(true, async (calls) => {
    const preflight = await handleRequest(request('OPTIONS'))
    assert(preflight.headers.get('Access-Control-Allow-Origin') === '*', 'CORS missing')
    assert((await handleRequest(request('GET'))).status === 405, 'GET accepted')
    assert(calls.length === 0, 'Database called')
  })
})

Deno.test('rejects malformed tokens without touching the database', async () => {
  await scenario(true, async (calls) => {
    assert((await handleRequest(request('POST', '?token=abc'))).status === 400, 'Bad token accepted')
    assert(calls.length === 0, 'Database called for a malformed token')
  })
})

Deno.test('unsubscribes a known token and reports unknown ones', async () => {
  await scenario(true, async (calls) => {
    const response = await handleRequest(request('POST'))
    assert(response.status === 200 && (await response.json()).unsubscribed === true, 'Not unsubscribed')
    assert(
      calls[0].url.includes('/rpc/unsubscribe_notifications') && calls[0].body?.p_token === token,
      'Token not passed',
    )
  })
  await scenario(false, async () => {
    assert((await handleRequest(request('POST'))).status === 404, 'Unknown token accepted')
  })
})
