import { handleRequest } from './handler.ts'

const userId = '10000000-0000-0000-0000-000000000001'
const topicId = '20000000-0000-0000-0000-000000000001'
function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message)
}
interface Scenario {
  googleSub?: string
  channel?: string
  private?: boolean
  budget?: boolean
  invalidUser?: boolean
}
async function scenario(
  options: Scenario,
  test: (
    response: Response,
    calls: { url: string; body: unknown; headers: Headers }[],
  ) => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const oldUrl = Deno.env.get('SUPABASE_URL'),
    oldKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  Deno.env.set('SUPABASE_URL', 'https://agape-test.invalid')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-server-key')
  const calls: { url: string; body: unknown; headers: Headers }[] = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
    })
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url.includes('/auth/v1/user'))
      return options.invalidUser
        ? json({ message: 'Invalid JWT' }, 401)
        : json({
            id: userId,
            identities: [{ provider: 'google', identity_data: { sub: 'google-owner' } }],
          })
    if (url.includes('/rpc/consume_verification')) return json(options.budget !== false)
    if (url.includes('/oauth2/v3/userinfo'))
      return json({ sub: options.googleSub || 'google-owner' })
    if (url.includes('/youtube/v3/channels'))
      return json({ items: [{ id: 'owned-channel', snippet: { title: 'Creator' } }] })
    if (url.includes('/youtube/v3/videos'))
      return json({
        items: [
          {
            snippet: {
              channelId: options.channel || 'owned-channel',
              title: 'Video',
              categoryId: '27',
              liveBroadcastContent: 'none',
            },
            status: { privacyStatus: options.private ? 'private' : 'public', embeddable: true },
            contentDetails: { duration: 'PT2M15S' },
          },
        ],
      })
    if (url.includes('/rpc/record_verified_video')) return json(null)
    throw new Error('Unexpected outgoing request: ' + url)
  }
  try {
    const response = await handleRequest(
      new Request('https://app.invalid/verify', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-user-token' },
        body: JSON.stringify({
          video_id: 'abcdefghijk',
          node_id: topicId,
          provider_token: 'google-access-token',
          p_user: 'forged-user-id',
        }),
      }),
    )
    await test(response, calls)
  } finally {
    globalThis.fetch = originalFetch
    if (oldUrl === undefined) Deno.env.delete('SUPABASE_URL')
    else Deno.env.set('SUPABASE_URL', oldUrl)
    if (oldKey === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', oldKey)
  }
}

Deno.test('rejects requests without a bearer token before touching services', async () => {
  const response = await handleRequest(
    new Request('https://app.invalid/verify', { method: 'POST', body: '{}' }),
  )
  assert(response.status === 401, 'Missing authentication must be rejected')
  await response.body?.cancel()
})
Deno.test('binds the Google token to the signed-in Supabase identity', async () => {
  await scenario({ googleSub: 'different-google-user' }, async (response, calls) => {
    assert(response.status === 403, 'Mismatched Google identity must be rejected')
    assert(
      !calls.some((c) => c.url.includes('/record_verified_video')),
      'Mismatched identity must not write a video',
    )
    await response.body?.cancel()
  })
})
Deno.test('rejects videos from a different YouTube channel', async () => {
  await scenario({ channel: 'other-channel' }, async (response, calls) => {
    assert(response.status === 403, 'Non-owner submission must be rejected')
    assert(
      !calls.some((c) => c.url.includes('/record_verified_video')),
      'Non-owner must not import',
    )
    await response.body?.cancel()
  })
})
Deno.test('does not import private videos', async () => {
  await scenario({ private: true }, async (response) => {
    assert(response.status === 400, 'Private videos are not eligible')
    await response.body?.cancel()
  })
})
Deno.test('enforces the budget before calling Google', async () => {
  await scenario({ budget: false }, async (response, calls) => {
    assert(response.status === 429, 'Rate-limited requests must fail')
    assert(
      calls.every((c) => !c.url.includes('googleapis')),
      'Exhausted budgets must not call Google',
    )
    await response.body?.cancel()
  })
})
Deno.test('rejects invalid Supabase sessions', async () => {
  await scenario({ invalidUser: true }, async (response, calls) => {
    assert(response.status === 401, 'Invalid session must fail')
    assert(calls.length === 1, 'Invalid sessions must stop after user lookup')
    await response.body?.cancel()
  })
})
Deno.test('imports only verified server-derived metadata into the agape schema', async () => {
  await scenario({}, async (response, calls) => {
    assert(response.status === 200, 'Valid owner submission should succeed')
    const saved = calls.find((c) => c.url.includes('/record_verified_video'))!
    assert(
      saved.headers.get('Content-Profile') === 'agape',
      'Import must target the independent schema',
    )
    const body = saved.body as Record<string, unknown>
    assert(body.p_user === userId, 'User ID must come from verified session, not request body')
    assert(
      body.p_duration === 135 && body.p_channel === 'owned-channel',
      'Metadata must come from YouTube',
    )
    assert(
      !JSON.stringify(body).includes('google-access-token'),
      'Google token must not be persisted',
    )
    await response.body?.cancel()
  })
})
