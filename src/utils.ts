export function videoId(value: string): string | null {
  const trimmed = value.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.hostname.replace(/^www\./, '')
    let id: string | null = null
    if (host === 'youtu.be') id = url.pathname.split('/')[1]
    if (['youtube.com', 'm.youtube.com'].includes(host)) {
      id =
        url.searchParams.get('v') ||
        (/^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null)
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null
  } catch {
    return null
  }
}
export function timeLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds)))
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export function safeLink(url: string) {
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''
  } catch {
    return ''
  }
}
export function activeCues<T extends { start_seconds: number; end_seconds: number }>(
  cues: T[],
  time: number,
) {
  return cues.filter((c) => Number(c.start_seconds) <= time && time < Number(c.end_seconds))
}

export function programTimeline(clips: { start_seconds: number; end_seconds: number }[]) {
  let total = 0
  const segments = clips.map((clip, index) => {
    const duration = Number(clip.end_seconds) - Number(clip.start_seconds)
    const segment = { index, offset: total, duration, videoStart: Number(clip.start_seconds) }
    total += duration
    return segment
  })
  return { segments, total }
}
export function programSeek(
  clips: { start_seconds: number; end_seconds: number }[],
  seconds: number,
) {
  const { segments, total } = programTimeline(clips)
  if (!segments.length) return null
  const position = Math.max(0, Math.min(total, seconds))
  const segment =
    segments.find((s) => position < s.offset + s.duration) || segments[segments.length - 1]
  return { index: segment.index, time: segment.videoStart + position - segment.offset }
}
