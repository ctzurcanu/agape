import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

interface Claimed {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  email: string
  unsubscribe_token: string
}
function respond(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (c) => entities[c])
}
function sameSecret(given: string, expected: string) {
  if (given.length !== expected.length) return false
  let difference = 0
  for (let i = 0; i < given.length; i++) difference |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return difference === 0
}

// Called by the scheduled workflow: queues closed-ballot notices, then emails opted-in notices.
export async function handleRequest(request: Request) {
  if (request.method !== 'POST') return respond(405, { error: 'POST required' })
  const secret = Deno.env.get('AGAPE_CRON_SECRET')
  if (!secret || !sameSecret(request.headers.get('x-agape-cron') || '', secret))
    return respond(401, { error: 'Unauthorized' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'agape' },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const closed = await admin.rpc('notify_closed_ballots')
  if (closed.error) return respond(500, { error: 'Could not prepare ballot notices.' })
  const apiKey = Deno.env.get('AGAPE_RESEND_API_KEY'),
    from = Deno.env.get('AGAPE_EMAIL_FROM'),
    site = Deno.env.get('AGAPE_SITE_URL')
  // Unconfigured email leaves notices unclaimed, so they can be sent once configured.
  if (!apiKey || !from || !site)
    return respond(503, {
      error: 'Email delivery is not configured.',
      ballot_notices: closed.data,
    })
  const siteBase = site.endsWith('/') ? site : `${site}/`
  const { data, error } = await admin.rpc('claim_notification_emails', { p_limit: 50 })
  if (error) return respond(500, { error: 'Could not claim notices.' })
  let sent = 0,
    failed = 0
  for (const notice of (data || []) as Claimed[]) {
    const link = new URL(notice.link || '#/notifications', siteBase).href
    const stopPage = new URL(`unsubscribe.html?token=${notice.unsubscribe_token}`, siteBase).href
    const oneClick = `${supabaseUrl}/functions/v1/agape-unsubscribe?token=${notice.unsubscribe_token}`
    const text = `${notice.title}\n\n${notice.body}\n\nOpen in Agape: ${link}\n\nStop these emails: ${stopPage}`
    const html =
      `<p><strong>${escapeHtml(notice.title)}</strong></p><p>${escapeHtml(notice.body)}</p>` +
      `<p><a href="${escapeHtml(link)}">Open in Agape</a></p>` +
      `<p style="color:#666;font-size:13px">You receive this because you turned on Agape email notices. ` +
      `<a href="${escapeHtml(stopPage)}">Stop these emails</a>.</p>`
    let ok = false,
      problem = ''
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [notice.email],
          subject: notice.title,
          text,
          html,
          headers: {
            'List-Unsubscribe': `<${oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
        signal: AbortSignal.timeout(10000),
      })
      ok = response.ok
      if (!ok) problem = `Resend ${response.status}`
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Delivery failed'
    }
    await admin.rpc('record_notification_email', {
      p_id: notice.id,
      p_ok: ok,
      p_error: ok ? null : problem,
    })
    if (ok) sent++
    else failed++
  }
  return respond(200, { ballot_notices: closed.data, sent, failed })
}
