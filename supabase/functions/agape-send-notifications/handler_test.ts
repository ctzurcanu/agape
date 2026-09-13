import { handleRequest } from './handler.ts'

function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message)
}
interface Call {
  url: string
  body: Record<string, unknown> | null
  headers: Headers
}
const baseEnv = {
  SUPABASE_URL: 'https://agape-test.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
  AGAPE_CRON_SECRET: 'cron-secret',
  AGAPE_RESEND_API_KEY: 're_test',
  AGAPE_EMAIL_FROM: 'Agape <notices@example.org>',
  AGAPE_SITE_URL: 'https://example.org/agape/',
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

async function scenario(
  env: Record<string, string | undefined>,
  reply: (url: string, calls: Call[]) => Response,
  test: (calls: Call[]) => Promise<void>,
) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]))
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) Deno.env.delete(k)
    else Deno.env.set(k, v)
  }
  const originalFetch = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (input, init) => {
    const url = String(input)
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
    })
    return Promise.resolve(reply(url, calls))
  }
  try {
    await test(calls)
  } finally {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
  }
}
const post = (secret = 'cron-secret') =>
  new Request('https://functions.invalid/agape-send-notifications', {
    method: 'POST',
    headers: { 'x-agape-cron': secret },
  })

Deno.test('rejects requests without the delivery secret', async () => {
  await scenario(baseEnv, () => json(null), async (calls) => {
    const response = await handleRequest(post('wrong'))
    assert(response.status === 401, 'Wrong secret accepted')
    assert(calls.length === 0, 'Database called without the secret')
    assert((await handleRequest(new Request('https://f.invalid'))).status === 405, 'GET accepted')
  })
})

Deno.test('leaves notices unclaimed while email is not configured', async () => {
  await scenario(
    { ...baseEnv, AGAPE_RESEND_API_KEY: undefined },
    (url) => (url.includes('/rpc/notify_closed_ballots') ? json(2) : json([])),
    async (calls) => {
      const response = await handleRequest(post())
      assert(response.status === 503, 'Missing email configuration not reported')
      assert(
        calls.some((c) => c.url.includes('/rpc/notify_closed_ballots')),
        'Closed ballots not queued',
      )
      assert(
        !calls.some((c) => c.url.includes('/rpc/claim_notification_emails')),
        'Notices claimed without a way to send them',
      )
    },
  )
})

Deno.test('sends claimed notices and records each result', async () => {
  const token = '11111111-1111-4111-8111-111111111111'
  let resendCalls = 0
  await scenario(
    baseEnv,
    (url) => {
      if (url.includes('/rpc/notify_closed_ballots')) return json(0)
      if (url.includes('/rpc/claim_notification_emails'))
        return json([
          {
            id: 'n1',
            kind: 'review',
            title: 'Approved <b>now</b>',
            body: 'Body & more',
            link: '#/studio',
            email: 'a@example.org',
            unsubscribe_token: token,
          },
          {
            id: 'n2',
            kind: 'fine',
            title: 'Fine',
            body: 'Reason',
            link: null,
            email: 'b@example.org',
            unsubscribe_token: token,
          },
        ])
      if (url === 'https://api.resend.com/emails')
        return ++resendCalls === 1 ? json({ id: 'email-1' }) : json({ message: 'down' }, 500)
      return json(null)
    },
    async (calls) => {
      const response = await handleRequest(post())
      const result = await response.json()
      assert(response.status === 200 && result.sent === 1 && result.failed === 1, 'Counts wrong')
      const emails = calls.filter((c) => c.url === 'https://api.resend.com/emails')
      assert(emails.length === 2, 'Expected two emails')
      const first = emails[0]
      assert(first.headers.get('Authorization') === 'Bearer re_test', 'API key not sent')
      assert(JSON.stringify(first.body?.to) === '["a@example.org"]', 'Wrong recipient')
      assert(String(first.body?.html).includes('Approved &lt;b&gt;now&lt;/b&gt;'), 'HTML not escaped')
      assert(String(first.body?.text).includes('https://example.org/agape/#/studio'), 'Link missing')
      assert(
        String(first.body?.text).includes(`https://example.org/agape/unsubscribe.html?token=${token}`),
        'Unsubscribe page missing',
      )
      const listHeaders = first.body?.headers as Record<string, string>
      assert(
        listHeaders['List-Unsubscribe'] ===
          `<https://agape-test.invalid/functions/v1/agape-unsubscribe?token=${token}>`,
        'One-click unsubscribe header missing',
      )
      const records = calls.filter((c) => c.url.includes('/rpc/record_notification_email'))
      assert(records.length === 2, 'Results not recorded')
      assert(records[0].body?.p_id === 'n1' && records[0].body?.p_ok === true, 'Success not recorded')
      assert(
        records[1].body?.p_ok === false && records[1].body?.p_error === 'Resend 500',
        'Failure not recorded',
      )
    },
  )
})
