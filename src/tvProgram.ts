import { db, result, type Cue, type Fragment } from './api'
import { programTimeline } from './utils'
export type TVCue = Cue & { section_id?: string }
export function programCues(sections: Fragment[], cues: TVCue[], revision: number): TVCue[] {
  const timeline = programTimeline(sections)
  return cues.flatMap((c) => {
    const i = sections.findIndex((f) => f.id === c.section_id),
      s = timeline.segments[i]
    if (!s || c.end_seconds <= s.videoStart || c.start_seconds >= s.videoStart + s.duration)
      return []
    return [
      {
        ...c,
        revision,
        start_seconds: s.offset + Math.max(c.start_seconds, s.videoStart) - s.videoStart,
        end_seconds: s.offset + Math.min(c.end_seconds, s.videoStart + s.duration) - s.videoStart,
      },
    ]
  })
}
export function sourceCues(sections: Fragment[], cues: TVCue[]): TVCue[] {
  const timeline = programTimeline(sections)
  return cues.flatMap((c) => {
    const hits = timeline.segments.filter(
      (s) => c.end_seconds > s.offset && c.start_seconds < s.offset + s.duration,
    )
    return hits.map((s, i) => ({
      ...c,
      id: i === 0 ? c.id : crypto.randomUUID(),
      section_id: sections[s.index].id,
      video_id: sections[s.index].video_id,
      start_seconds: s.videoStart + Math.max(0, c.start_seconds - s.offset),
      end_seconds: s.videoStart + Math.min(s.duration, c.end_seconds - s.offset),
    }))
  })
}
export function retimeProgramCues(cues: TVCue[], before: Fragment[], after: Fragment[]): TVCue[] {
  // Convert through source time, so text follows its video section when it moves.
  const source = sourceCues(before, cues)
  return source.flatMap((c) => programCues(after, [c], c.revision || 0))
}
export async function loadTVTrack(
  node: string | undefined,
  sections: Fragment[],
  track: string,
  locale: string,
) {
  const edition = await result<{ cues: TVCue[]; revision: number } | null>(
    db()
      .from('tv_selection_track')
      .select('cues,revision')
      .eq('selection_key', node || 'root')
      .eq('track', track)
      .eq('locale', locale)
      .maybeSingle(),
  )
  if (edition)
    return {
      revision: edition.revision,
      cues: programCues(sections, edition.cues, edition.revision),
    }
  const seen = new Set<string>()
  const sources = await Promise.all(
    sections.map(async (f) => {
      const cues = await result<Cue[]>(
        db()
          .from(f.curated ? 'tv_subtitle_cue' : 'subtitle_cues')
          .select('*')
          .eq(f.curated ? 'fragment_id' : 'video_id', f.curated ? f.id : f.video_id)
          .eq('track', track)
          .eq('locale', locale),
      )
      return cues
        .filter((c) => c.end_seconds > f.start_seconds && c.start_seconds < f.end_seconds)
        .map((c) => {
          const id = seen.has(c.id) ? crypto.randomUUID() : c.id
          seen.add(id)
          return {
            ...c,
            id,
            section_id: f.id,
            start_seconds: Math.max(f.start_seconds, c.start_seconds),
            end_seconds: Math.min(f.end_seconds, c.end_seconds),
          }
        })
    }),
  )
  return { revision: 0, cues: programCues(sections, sources.flat(), 0) }
}
