import { useEffect, useRef, useState } from 'react'
import { db, result, type Cue, type Fragment } from './api'
import { SubtitleEditor } from './SubtitleEditor'
import { loadTVTrack, programCues, sourceCues } from './tvProgram'
import { programTimeline, videoId } from './utils'

function SectionTiming({
  section,
  disabled,
  save,
}: {
  section: Fragment
  disabled: boolean
  save: (start: number, end: number) => void
}) {
  const [start, setStart] = useState(String(section.start_seconds)),
    [end, setEnd] = useState(String(section.end_seconds))
  useEffect(() => {
    setStart(String(section.start_seconds))
    setEnd(String(section.end_seconds))
  }, [section.start_seconds, section.end_seconds])
  return (
    <form
      className="tv-section-timing"
      onSubmit={(e) => {
        e.preventDefault()
        save(Number(start), Number(end))
      }}
    >
      <label>
        Source start (s)
        <input
          aria-label={`Source start for ${section.title}`}
          type="number"
          min="0"
          required
          value={start}
          disabled={disabled}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <label>
        Source end (s)
        <input
          aria-label={`Source end for ${section.title}`}
          type="number"
          min={Number(start) + 1}
          required
          value={end}
          disabled={disabled}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>
      <button
        disabled={
          disabled ||
          (Number(start) === section.start_seconds && Number(end) === section.end_seconds)
        }
      >
        Save trim
      </button>
    </form>
  )
}

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
  const [sectionTools, setSectionTools] = useState(false)
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
    const [moving] = next.splice(index, 1)
    next.splice(target, 0, moving)
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
  async function trim(section: Fragment, start: number, end: number) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await result(
        db().rpc('trim_tv_section', {
          p_node: node || null,
          p_section: section.id,
          p_expected_start: section.start_seconds,
          p_expected_end: section.end_seconds,
          p_start: start,
          p_end: end,
        }),
      )
      const next = sections.map((f) =>
        f.id === section.id ? { ...f, start_seconds: start, end_seconds: end } : f,
      )
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
      <details
        className="tv-section-manager"
        open={sectionTools}
        onToggle={(e) => setSectionTools(e.currentTarget.open)}
      >
        <summary>Add video fragments & precise source times</summary>
        <h2>Video sections</h2>
        <p>
          Reorder with Move earlier / Move later. Set each section’s start and end within its
          original video, then Save trim. Changes save immediately for this TV selection.
        </p>
        {!admin && (
          <p className="notice">
            {userId
              ? 'Your account needs Agape administrator access to change the sequence.'
              : 'Join with your administrator account to add, reorder, and trim sections.'}{' '}
            {!userId && <button onClick={signIn}>Join</button>}
          </p>
        )}
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
                Move earlier
              </button>
              <button
                disabled={!admin || busy || i === sections.length - 1}
                aria-label={`Move section ${i + 1} down`}
                onClick={() => void move(i, 1)}
              >
                Move later
              </button>
              <SectionTiming
                section={f}
                disabled={!admin || busy}
                save={(start, end) => void trim(f, start, end)}
              />
            </li>
          ))}
        </ol>
        <form
          className="se-toolbar"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <fieldset className="se-toolbar tv-add-section" disabled={!admin || busy}>
            <h3>Add video section</h3>
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
          </fieldset>
        </form>
      </details>
      <p className="video-lane-help">
        <button onClick={() => setSectionTools((v) => !v)}>
          + Add video fragment / precise trim
        </button>{' '}
        Video fragments are on the blue lane above the subtitles. Drag a block to reorder; drag its
        edges to trim. Click a block to preview.{' '}
        {!admin && 'Join as an administrator to change video sections.'}
      </p>
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
            layoutDisabled: !admin || busy,
            moveSection: (from, to) => void move(from, to - from),
            trimSection: (section, start, end) => void trim(section, start, end),
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
