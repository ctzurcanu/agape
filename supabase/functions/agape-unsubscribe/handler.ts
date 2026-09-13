import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
function respond(status: number, body: object) {
  return new Response(JSON.stringify(body), { status, headers })
}
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Turns off all Agape emails for the token's owner. Used by the site's unsubscribe page and by
// mail clients' one-click unsubscribe (RFC 8058); the token is the only credential.
export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'POST') return respond(405, { error: 'POST required' })
  const token = new URL(request.url).searchParams.get('token') || ''
  if (!tokenPattern.test(token))
    return respond(400, { error: 'This unsubscribe link is incomplete.' })
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'agape' }, auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await admin.rpc('unsubscribe_notifications', { p_token: token })
  if (error) return respond(500, { error: 'Unsubscribe is temporarily unavailable.' })
  return data
    ? respond(200, { unsubscribed: true })
    : respond(404, { error: 'This unsubscribe link is no longer valid.' })
}
