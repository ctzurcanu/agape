import { createClient } from 'npm:@supabase/supabase-js@2.57.0'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
function respond(status: number, body: object) {
  return new Response(JSON.stringify(body), { status, headers })
}
class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}
async function google(path: string, token: string) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok)
    throw new RequestError(
      response.status === 401 || response.status === 403
        ? 'Reconnect Google and grant YouTube read access, then try again.'
        : 'YouTube is unavailable. Please try again later.',
      400,
    )
  return response.json()
}
function duration(value: string) {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value)
  if (!match) return 0
  return (
    Number(match[1] || 0) * 86400 +
    Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 +
    Number(match[4] || 0)
  )
}
export async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers })
  if (request.method !== 'POST') return respond(405, { error: 'POST required' })
  try {
    const authorization = request.headers.get('Authorization') || ''
    if (!authorization.startsWith('Bearer ')) throw new RequestError('Sign in first.', 401)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        db: { schema: 'agape' },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    )
    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(authorization.slice(7))
    if (authError || !user) throw new RequestError('Your session has expired. Sign in again.', 401)
    const text = await request.text()
    if (text.length > 10000) throw new RequestError('Request too large.', 413)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new RequestError('Invalid request.')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError('Invalid request.')
    }
    const { video_id, node_id, provider_token } = body
    if (
      typeof video_id !== 'string' ||
      !/^[\w-]{11}$/.test(video_id) ||
      typeof node_id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(node_id) ||
      typeof provider_token !== 'string' ||
      provider_token.length < 10 ||
      provider_token.length > 8000
    )
      throw new RequestError('Video, topic, and Google authorization are required.')
    const { data: budget, error: budgetError } = await admin.rpc('consume_verification', {
      p_user: user.id,
    })
    if (budgetError)
      throw new RequestError('Verification is not configured. Apply Agape’s migrations.', 503)
    if (!budget)
      throw new RequestError(
        'You can verify up to 10 videos per hour. Please try again later.',
        429,
      )
    // Bind the supplied Google token to the Google identity of this Supabase user.
    const profile = await google('https://www.googleapis.com/oauth2/v3/userinfo', provider_token)
    const identity = user.identities?.find((i) => i.provider === 'google')
    if (!identity || identity.identity_data?.sub !== profile.sub)
      throw new RequestError('This Google account does not match your signed-in account.', 403)
    const [channels, videos] = await Promise.all([
      google(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        provider_token,
      ),
      google(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(video_id)}`,
        provider_token,
      ),
    ])
    const video = videos.items?.[0]
    if (!video) throw new RequestError('Video not found. Use a published YouTube video.')
    const channel = channels.items?.find((c: { id: string }) => c.id === video.snippet.channelId)
    if (!channel)
      throw new RequestError(
        'This video does not belong to the YouTube channel authorized by your Google account.',
        403,
      )
    if (
      video.status.privacyStatus !== 'public' ||
      !video.status.embeddable ||
      video.snippet.liveBroadcastContent !== 'none'
    ) {
      throw new RequestError(
        'Choose a public, embeddable video that is not an upcoming or live broadcast.',
      )
    }
    const seconds = duration(video.contentDetails.duration)
    if (!seconds) throw new RequestError('This video has no usable duration yet.')
    const { error } = await admin.rpc('record_verified_video', {
      p_user: user.id,
      p_channel: channel.id,
      p_channel_title: channel.snippet.title,
      p_video: video_id,
      p_title: video.snippet.title,
      p_category: video.snippet.categoryId,
      p_duration: seconds,
      p_node: node_id,
    })
    if (error)
      throw new RequestError(
        'The video could not be saved. Check the topic and connected channel, then try again.',
      )
    return respond(200, { video_id, verified: true })
  } catch (error) {
    if (error instanceof RequestError) return respond(error.status, { error: error.message })
    return respond(500, { error: 'Verification is temporarily unavailable. Please try again.' })
  }
}
