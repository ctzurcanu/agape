import { describe, it, expect } from 'vitest'
import { videoId, safeLink, activeCues, timeLabel } from './utils'
describe('YouTube input', () => {
  it('accepts supported links and rejects lookalike hosts', () => {
    for (const value of [
      'abcdefghijk',
      'https://youtu.be/abcdefghijk?t=5',
      'https://www.youtube.com/watch?v=abcdefghijk',
      'https://youtube.com/shorts/abcdefghijk',
    ])
      expect(videoId(value)).toBe('abcdefghijk')
    for (const value of [
      'https://youtube.com.evil.org/watch?v=abcdefghijk',
      'https://example.com/abcdefghijk',
      'short',
      'javascript:abcdefghijk',
    ])
      expect(videoId(value)).toBeNull()
  })
})
describe('limited Markdown links', () => {
  it('allows only absolute web links', () => {
    expect(safeLink('https://example.org/a')).toBe('https://example.org/a')
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,abc',
      '//example.org',
      '/admin',
      'mailto:a@b.com',
    ])
      expect(safeLink(href)).toBe('')
  })
})
it('uses half-open cue boundaries, including overlaps and seeks', () => {
  const cues = [
    { start_seconds: 0, end_seconds: 5 },
    { start_seconds: 4, end_seconds: 9 },
  ]
  expect(activeCues(cues, 4)).toHaveLength(2)
  expect(activeCues(cues, 5)).toEqual([cues[1]])
  expect(activeCues(cues, 0)).toEqual([cues[0]])
  expect(activeCues(cues, 9)).toHaveLength(0)
})
it('formats times including hours', () => {
  expect(timeLabel(65)).toBe('1:05')
  expect(timeLabel(3605)).toBe('1:00:05')
})

it('renders only limited subtitle markup and safe web links', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { Markdown } = await import('./Markdown')
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: '**Bold** *italic* [source](https://example.org) ![image](https://example.org/image.png) <script>alert(1)</script> [unsafe](javascript:alert)',
    }),
  )
  expect(html).toContain('<strong>Bold</strong>')
  expect(html).toContain('<em>italic</em>')
  expect(html).toContain('href="https://example.org/"')
  expect(html).not.toMatch(/<script|<img|href="javascript:/)
})

it('maps program positions across unequal excerpts and exact video boundaries', async () => {
  const { programTimeline, programSeek } = await import('./utils')
  const clips = [
    { start_seconds: 30, end_seconds: 75 },
    { start_seconds: 100, end_seconds: 160 },
    { start_seconds: 5, end_seconds: 20 },
  ]
  expect(programTimeline(clips).total).toBe(120)
  expect(programSeek(clips, 0)).toEqual({ index: 0, time: 30 })
  expect(programSeek(clips, 44)).toEqual({ index: 0, time: 74 })
  expect(programSeek(clips, 45)).toEqual({ index: 1, time: 100 })
  expect(programSeek(clips, 70)).toEqual({ index: 1, time: 125 })
  expect(programSeek(clips, 105)).toEqual({ index: 2, time: 5 })
  expect(programSeek(clips, 999)).toEqual({ index: 2, time: 20 })
  expect(programSeek(clips, -1)).toEqual({ index: 0, time: 30 })
  expect(programSeek([], 0)).toBeNull()
})

it('switches YouTube captions on and off without replacing the player', async () => {
  const { setYouTubeCaptions } = await import('./Player')
  const calls: string[] = []
  const player = {
    loadModule: (name: string) => calls.push(`load:${name}`),
    unloadModule: (name: string) => calls.push(`unload:${name}`),
  }
  setYouTubeCaptions(player as unknown as YT.Player, true)
  setYouTubeCaptions(player as unknown as YT.Player, false)
  expect(calls).toEqual(['load:captions', 'unload:captions', 'unload:cc'])
})
