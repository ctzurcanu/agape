import { describe, it, expect } from 'vitest'
import { programCues, sourceCues, retimeProgramCues } from './tvProgram'
import type { Fragment, Cue } from './api'
const sections: Fragment[] = [
  {
    id: 'a',
    video_id: 'aaaaaaaaaaa',
    title: 'First',
    video_title: 'First',
    channel_title: '',
    start_seconds: 30,
    end_seconds: 75,
  },
  {
    id: 'b',
    video_id: 'bbbbbbbbbbb',
    title: 'Second',
    video_title: 'Second',
    channel_title: '',
    start_seconds: 10,
    end_seconds: 30,
  },
]
const cue: Cue = {
  id: 'one',
  video_id: 'aaaaaaaaaaa',
  section_id: 'a',
  locale: 'en',
  start_seconds: 35,
  end_seconds: 40,
  markdown: 'Hello',
  revision: 2,
}
describe('TV program subtitle timing', () => {
  it('maps source seconds to continuous program seconds and back', () => {
    const projected = programCues(sections, [cue], 2)
    expect(projected[0].start_seconds).toBe(5)
    expect(sourceCues(sections, projected)[0]).toEqual(cue)
  })
  it('keeps subtitles with their video when sections reorder', () => {
    const before = programCues(sections, [cue], 2)
    const after = retimeProgramCues(before, sections, [sections[1], sections[0]])
    expect(after[0].start_seconds).toBe(25)
    expect(after[0].section_id).toBe('a')
    expect(after[0].revision).toBe(2)
  })
  it('splits a cue at video boundaries without leaking source timestamps', () => {
    const parts = sourceCues(sections, [{ ...cue, start_seconds: 43, end_seconds: 48 }])
    expect(parts).toHaveLength(2)
    expect(parts.map((c) => [c.section_id, c.start_seconds, c.end_seconds])).toEqual([
      ['a', 73, 75],
      ['b', 10, 13],
    ])
    expect(parts[0].id).not.toBe(parts[1].id)
  })
  it('preserves timestamps when appending a new section', () => {
    const projected = programCues(sections, [cue], 2)
    expect(
      retimeProgramCues(projected, sections, [...sections, { ...sections[0], id: 'c' }]),
    ).toEqual(projected)
  })
})
