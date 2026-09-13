import { describe, it, expect } from 'vitest'
import {
  timestamp,
  subtitleLanes,
  parseTimestamp,
  parseSubtitles,
  exportSubtitles,
  cueProblems,
  subtitleChanges,
} from './subtitles'
const srt =
  '1\r\n00:00:30,125 --> 00:00:35,500\r\n**Hello**\r\n[source](https://example.com)\r\n\r\n2\r\n00:00:36,000 --> 00:00:39,000\r\nWorld'
describe('subtitle editing interoperability', () => {
  it('round trips multiline Markdown links and millisecond timing in SRT and VTT', () => {
    const cues = parseSubtitles(srt)
    for (const f of ['srt', 'vtt'] as const) {
      const result = parseSubtitles(exportSubtitles(cues, f))
      expect(result.map(({ id, ...c }) => c)).toEqual(cues.map(({ id, ...c }) => c))
    }
  })
  it('parses WebVTT identifiers, cue settings and notes', () => {
    expect(
      parseSubtitles(
        'WEBVTT\n\nNOTE skip this\n\ncue-1\n00:30.000 --> 00:35.000 align:start\n<b>Hello</b>',
      )[0].markdown,
    ).toBe('**Hello**')
  })
  it('rejects malformed timing and empty content', () => {
    expect(() => parseTimestamp('01:99:00.000')).toThrow()
    expect(() => parseSubtitles('1\n00:00:35,000 --> 00:00:30,000\nNo')).toThrow()
    expect(() => parseSubtitles('arbitrary text')).toThrow()
  })
  it('handles hour and millisecond rollover', () => {
    expect(timestamp(3599.9999)).toBe('01:00:00.000')
    expect(parseTimestamp('01:02:03.4')).toBe(3723.4)
  })
  it('distinguishes blocking bounds errors from reading warnings', () => {
    const cues = parseSubtitles(srt)
    cues[1].start_seconds = 34
    expect(cueProblems(cues, 30, 75).some((p) => p.warnings.includes('Overlaps another cue'))).toBe(
      true,
    )
    cues[0].start_seconds = 29
    expect(cueProblems(cues, 30, 75)[0].errors.length).toBe(1)
  })
  it('keeps expected revisions and only sends actual changes', () => {
    const base = parseSubtitles(srt).map((c) => ({ ...c, revision: 4 }))
    const next = [{ ...base[0], markdown: 'Edited' }]
    const changes = subtitleChanges(base, next)
    expect(changes).toHaveLength(2)
    expect(changes.map((c) => c.operation)).toEqual(['delete', 'update'])
    expect(changes.every((c) => c.expected === 4)).toBe(true)
    expect(subtitleChanges(base, [...base].reverse())).toEqual([])
  })
})

it('packs adjacent cues on lane one and overlaps on lane two', () => {
  const base = parseSubtitles(srt)
  const rows = [
    { ...base[0], id: 'a', start_seconds: 0, end_seconds: 5 },
    { ...base[0], id: 'b', start_seconds: 5, end_seconds: 10 },
    { ...base[0], id: 'c', start_seconds: 6, end_seconds: 8 },
    { ...base[0], id: 'd', start_seconds: 10, end_seconds: 12 },
  ]
  expect([...subtitleLanes(rows).values()]).toEqual([0, 0, 1, 0])
})
