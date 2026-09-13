import { useEffect, useRef, useState } from 'react'
import { db, result, type Cue, type Fragment } from './api'
import { SubtitleEditor } from './SubtitleEditor'
import { loadTVTrack, programCues, sourceCues } from './tvProgram'
import { programTimeline, videoId } from './utils'

export function TVProgramEditor({
  node,
  fragments,
  track,
  locale,
  userId,
  admin,
  signIn,
  onSaved,
  onLayoutSaved,
}: {
  node?: string
  fragments: Fragment[]
  track: string
  locale: string
  userId?: string
  admin: boolean
  signIn: () => void
  onSaved: () => void
  onLayoutSaved: (sections: Fragment[]) => void
}) {
  const [sections, setSections] = useState(fragments),
    [initial, setInitial] = useState<Cue[]>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [topicNames, setTopicNames] = useState<{ node_id: string; name: string }[]>([])
  useEffect(() => {
    void result<{ node_id: string; name: string }[]>(
      db().from('topic_labels').select('node_id,name').eq('locale', locale),
    )
      .then(setTopicNames)
      .catch(() => {})
  }, [locale])
  const expected = useRef(0),
    lastRead = useRef(0),
    orderRevision = useRef(0)
  const [url, setUrl] = useState(''),
    [title, setTitle] = useState(''),
    [channel, setChannel] = useState(''),
    [length, setLength] = useState(''),
    [start, setStart] = useState('0'),
    [end, setEnd] = useState('30')
  const [topic, setTopic] = useState(node || fragments.find((f) => f.node_id)?.node_id || '')
  const [history, setHistory] = useState<
      { id: number; revision: number; cues: Cue[]; recorded_at: string }[]
    >([]),
    [restoreDraft, setRestoreDraft] = useState<Cue[]>()
  useEffect(() => {
    let active = true
    Promise.all([
      loadTVTrack(node, fragments, track, locale),
      result<{ revision: number } | null>(
        db()
          .from('tv_selection_order')
          .select('revision')
          .eq('selection_key', node || 'root')
          .maybeSingle(),
      ),
    ])
      .then(([edition, order]) => {
        if (active) {
          expected.current = edition.revision
          lastRead.current = edition.revision
          orderRevision.current = order?.revision || 0
          setInitial(edition.cues)
        }
      })
      .catch((e) => setError(e.message))
    return () => {
      active = false
    }
  }, [node, track, locale])
  async function load(target: string) {
    const edition = await loadTVTrack(node, sections, target, locale)
    if (target === track) lastRead.current = edition.revision
    return edition.cues
  }
  async function publish(_base: Cue[], rows: Cue[]) {
    expected.current = await result<number>(
      db().rpc('save_tv_track', {
        p_node: node || null,
        p_track: track,
        p_locale: locale,
        p_expected: expected.current,
        p_cues: sourceCues(sections, rows),
      }),
    )
    return load(track)
  }
  async function move(index: number, direction: number) {
    if (busy) return
    const next = [...sections],
      target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setBusy(true)
    setError('')
    try {
      await result(
        db().rpc('save_tv_order', {
          p_node: node || null,
          p_expected: orderRevision.current,
          p_ids: next.map((f) => f.id),
        }),
      )
      orderRevision.current++
      setSections(next)
      onLayoutSaved(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function add() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const id = videoId(url)
      if (!id) throw new Error('Enter a YouTube video URL.')
      await result(
        db().rpc('add_tv_section', {
          p_node: topic,
          p_video: id,
          p_title: title,
          p_channel: channel,
          p_duration: Number(length),
          p_start: Number(start),
          p_end: Number(end),
        }),
      )
      const fresh = await result<{ fragments: Fragment[] }>(
        db().rpc('tv_browse', { p_node: node || null, p_locale: locale }),
      )
      setSections(fresh.fragments)
      onLayoutSaved(fresh.fragments)
      setUrl('')
      setTitle('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const timeline = programTimeline(sections)
  return (
    <div>
      <details className="tv-section-manager">
        <summary>Video sections · {sections.length} · Add & reorder</summary>
        {error && <p role="alert">{error}</p>}
        <ol>
          {sections.map((f, i) => (
            <li key={f.id}>
              <span>
                {f.title}{' '}
                <small>
                  ({f.start_seconds}–{f.end_seconds}s)
                </small>
              </span>
              <button
                disabled={!admin || busy || i === 0}
                aria-label={`Move section ${i + 1} up`}
                onClick={() => void move(i, -1)}
              >
                ↑
              </button>
              <button
                disabled={!admin || busy || i === sections.length - 1}
                aria-label={`Move section ${i + 1} down`}
                onClick={() => void move(i, 1)}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        {admin ? (
          <form
            className="se-toolbar"
            onSubmit={(e) => {
              e.preventDefault()
              void add()
            }}
          >
            <label>
              YouTube URL
              <input required value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label>
              Section title
              <input
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Channel credit
              <input required value={channel} onChange={(e) => setChannel(e.target.value)} />
            </label>
            <label>
              Video duration (s)
              <input
                type="number"
                required
                min="1"
                value={length}
                onChange={(e) => setLength(e.target.value)}
              />
            </label>
            <label>
              Start (s)
              <input
                type="number"
                required
                min="0"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              End (s)
              <input
                type="number"
                required
                min={Number(start) + 1}
                max={Number(length) || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label>
              Agape topic
              <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                {Array.from(new Set([node, ...sections.map((f) => f.node_id)].filter(Boolean))).map(
                  (id) => (
                    <option key={id} value={id}>
                      {id === node
                        ? 'This selection’s topic'
                        : topicNames.find((t) => t.node_id === id)?.name ||
                          'Selected section topic'}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button disabled={busy}>Add video section</button>
          </form>
        ) : (
          <p>
            Administrators can add and reorder video sections. Signed-in contributors can edit TV
            subtitles.
          </p>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
      {initial ? (
        <SubtitleEditor
          clip={{
            id: `program-${node || 'root'}`,
            video_id: sections[0]?.video_id || '',
            title: 'TV program',
            video_title: 'TV program',
            channel_title: '',
            start_seconds: 0,
            end_seconds: timeline.total,
          }}
          track={track}
          locale={locale}
          userId={userId}
          cues={initial}
          canEdit={Boolean(userId)}
          signIn={signIn}
          onSaved={onSaved}
          program={{
            get revision() {
              return expected.current
            },
            resumeRevision: (n) => {
              expected.current = n
            },
            sections,
            load,
            publish,
            acceptLatest: () => {
              expected.current = lastRead.current
            },
            restoreDraft,
          }}
          history={
            <section>
              <button
                onClick={() =>
                  void result<typeof history>(
                    db()
                      .from('tv_selection_history')
                      .select('id,revision,cues,recorded_at')
                      .eq('selection_key', node || 'root')
                      .eq('track', track)
                      .eq('locale', locale)
                      .order('revision', { ascending: false })
                      .limit(30),
                  )
                    .then(setHistory)
                    .catch((e) => setError(e.message))
                }
                disabled={!userId}
              >
                TV revision history
              </button>
              {history.map((h) => (
                <div key={h.id}>
                  Version {h.revision} · {new Date(h.recorded_at).toLocaleString()}{' '}
                  <button
                    onClick={() => setRestoreDraft(programCues(sections, h.cues, expected.current))}
                  >
                    Load as draft
                  </button>
                </div>
              ))}
            </section>
          }
        />
      ) : (
        <p>Loading subtitles for every video section…</p>
      )}
    </div>
  )
}
