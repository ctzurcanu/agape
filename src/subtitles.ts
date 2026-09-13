import type { Cue } from './api'
export type EditableCue = Cue & { revision?: number }
export const ordered = (cues: EditableCue[]) =>
  [...cues].sort((a, b) => a.start_seconds - b.start_seconds || a.end_seconds - b.end_seconds)
export function timestamp(seconds: number, separator = '.') {
  const ms = Math.round(Math.max(0, seconds) * 1000)
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`
}
export function parseTimestamp(value: string): number {
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  const m = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/)
  if (!m || +m[2] > 59 || +m[3] > 59) throw new Error('Use seconds or hh:mm:ss.mmm')
  return +(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000
}
export function parseSubtitles(input: string): EditableCue[] {
  const blocks = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n\s*\n/)
  const cues: EditableCue[] = []
  for (const block of blocks) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(block)) continue
    const lines = block.split('\n'),
      i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) throw new Error('Expected a timed SRT or WebVTT file.')
    const timing = lines[i].match(/^(\S+)\s+-->\s+(\S+)/)
    if (!timing) throw new Error('Invalid subtitle timing.')
    const start_seconds = parseTimestamp(timing[1]),
      end_seconds = parseTimestamp(timing[2])
    const markdown = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<b>(.*?)<\/b>/g, '**$1**')
      .replace(/<i>(.*?)<\/i>/g, '*$1*')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    if (end_seconds <= start_seconds || !markdown.trim())
      throw new Error('Every cue needs text and a positive duration.')
    cues.push({
      video_id: '',
      locale: '',
      id: crypto.randomUUID(),
      start_seconds,
      end_seconds,
      markdown,
    })
  }
  if (!cues.length) throw new Error('No timed subtitles found.')
  if (cues.length > 1000) throw new Error('Import at most 1,000 cues at a time.')
  return ordered(cues)
}
export function exportSubtitles(cues: EditableCue[], format: 'srt' | 'vtt') {
  // Preserve Agape Markdown as text so links survive a round trip.
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    ordered(cues)
      .map(
        (c, i) =>
          `${i + 1}\n${timestamp(c.start_seconds, format === 'srt' ? ',' : '.')} --> ${timestamp(c.end_seconds, format === 'srt' ? ',' : '.')}\n${c.markdown.replace(/\n\s*\n/g, '\n')}\n`,
      )
      .join('\n')
  )
}
export function cueProblems(cues: EditableCue[], start: number, end: number) {
  const sorted = ordered(cues)
  return sorted.flatMap((c, i) => {
    const errors: string[] = []
    if (
      !Number.isFinite(c.start_seconds) ||
      !Number.isFinite(c.end_seconds) ||
      c.start_seconds < start ||
      c.end_seconds > end ||
      c.end_seconds <= c.start_seconds
    )
      errors.push('Timing outside this video excerpt or end before start')
    if (!c.markdown.trim() || c.markdown.length > 2000)
      errors.push('Text must contain 1–2,000 characters')
    const visibleText = c.markdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*+/g, '')
    const warnings: string[] = []
    if (sorted.slice(0, i).some((p) => p.end_seconds > c.start_seconds))
      warnings.push('Overlaps another cue')
    if (visibleText.length / (c.end_seconds - c.start_seconds) > 20)
      warnings.push('Fast reading speed')
    if (visibleText.split('\n').some((l) => l.length > 42)) warnings.push('Long line')
    return errors.length || warnings.length ? [{ id: c.id, errors, warnings }] : []
  })
}
export function subtitleChanges(base: EditableCue[], next: EditableCue[]) {
  return [
    ...base
      .filter((c) => !next.some((n) => n.id === c.id))
      .map((c) => ({ ...c, operation: 'delete', expected: c.revision })),
    ...next
      .filter((c) => {
        const old = base.find((b) => b.id === c.id)
        return (
          !old ||
          old.markdown !== c.markdown ||
          old.start_seconds !== c.start_seconds ||
          old.end_seconds !== c.end_seconds
        )
      })
      .map((c) => ({
        ...c,
        operation: base.some((b) => b.id === c.id) ? 'update' : 'insert',
        expected: base.find((b) => b.id === c.id)?.revision,
      })),
  ]
}

/** Prefer the first lane whenever it is free; reserve the second for overlaps. */
export function subtitleLanes(cues: EditableCue[]): Map<string, number> {
  const ends = [-Infinity, -Infinity]
  const lanes = new Map<string, number>()
  for (const cue of ordered(cues)) {
    const lane = cue.start_seconds >= ends[0] ? 0 : 1
    lanes.set(cue.id, lane)
    ends[lane] = Math.max(ends[lane], cue.end_seconds)
  }
  return lanes
}
