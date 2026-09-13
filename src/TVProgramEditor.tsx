import { useEffect, useRef, useState } from 'react'
import { db, result, type Cue, type Fragment } from './api'
import { SubtitleEditor } from './SubtitleEditor'
import { loadTVTrack, programCues, sourceCues } from './tvProgram'
import { programTimeline, videoId } from './utils'

type EditionPreview = {
  title: string
  revision: number
  sections: { id: string; title: string; start_seconds: number; end_seconds: number }[]
  tracks: { track: string; locale: string; cues: number }[]
  fingerprint: string
}

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
  program,
  homeNode,
  fragments,
  track,
  locale,
  userId,
  signIn,
  onSaved,
  onLayoutSaved,
}: {
  program: string
  homeNode: string | null
  fragments: Fragment[]
  track: string
  locale: string
  userId?: string
  signIn: () => void
  onSaved: () => void
  onLayoutSaved: (sections: Fragment[]) => void
}) {
  const [owner, setOwner] = useState(false)
  const [programTitle, setProgramTitle] = useState('')
  const [savedTitle, setSavedTitle] = useState('')
  const [editionLink, setEditionLink] = useState('')
  const [review, setReview] = useState<EditionPreview>()
  const [layoutReady, setLayoutReady] = useState(false)
  // can_edit_tv covers both the TV's owner and site administrators.
  const admin = layoutReady && Boolean(userId) && owner
  useEffect(() => {
    setOwner(false)
    void Promise.all([
      result<boolean>(db().rpc('can_edit_tv', { p_program: program })),
      result<{ title: string } | null>(
        db().from('tv_program').select('title').eq('id', program).maybeSingle(),
      ),
    ])
      .then(([allowed, info]) => {
        setOwner(allowed)
        setProgramTitle(info?.title || 'Agape TV')
        setSavedTitle(info?.title || 'Agape TV')
      })
      .catch((e) => setError(e.message))
  }, [program, userId])
  const [sectionTools, setSectionTools] = useState(false)
  const publishedSections = useRef(fragments)
  const layoutKey = `agape.tv-layout-draft:program:${program}`
  const [localLayout, setLocalLayout] = useState(false)
  useEffect(() => {
    let active = true
    void result<{ fragments: Fragment[] }>(
      db().rpc('tv_program_view', { p_program: program, p_locale: locale }),
    )
      .then((fresh) => {
        if (!active) return
        publishedSections.current = fresh.fragments
        let next = fresh.fragments
        try {
          const stored = JSON.parse(localStorage.getItem(layoutKey) || 'null')
          const draft = Array.isArray(stored) ? stored : stored?.sections
          // Drafts may add or remove sections; the server checks topic membership on save.
          if (
            Array.isArray(draft) &&
            new Set(draft.map((f) => f.id)).size === draft.length &&
            draft.every(
              (f: Fragment) => Number.isFinite(f.start_seconds) && f.end_seconds > f.start_seconds,
            )
          ) {
            next = draft
            if (Array.isArray(stored?.base)) publishedSections.current = stored.base
            setLocalLayout(true)
          } else if (stored)
            setError(
              'A previous sequence draft is still stored, but this selection has changed. It has not been deleted.',
            )
        } catch {}
        setSections(next)
        onLayoutSaved(next)
        setLayoutReady(true)
      })
      .catch((e) => setError(e.message))
    return () => {
      active = false
    }
  }, [layoutKey])
  function keepLocal(next: Fragment[]) {
    setSections(next)
    onLayoutSaved(next)
    setLocalLayout(true)
    try {
      localStorage.setItem(
        layoutKey,
        JSON.stringify({ sections: next, base: publishedSections.current }),
      )
    } catch {
      setError('Local storage unavailable. Keep the editor open to retain sequence changes.')
    }
  }
  const [sections, setSections] = useState(fragments),
    [initial, setInitial] = useState<Cue[]>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [pool, setPool] = useState<Fragment[]>([])
  const [poolChoice, setPoolChoice] = useState('')
  useEffect(() => {
    void result<{ fragments: Fragment[] }>(
      db().rpc('tv_browse', { p_node: homeNode, p_locale: locale }),
    )
      .then((topic) => setPool(topic.fragments))
      .catch(() => {})
  }, [homeNode, locale])
  const [topicNames, setTopicNames] = useState<{ node_id: string; name: string }[]>([])
  useEffect(() => {
    void result<{ node_id: string; name: string }[]>(
      db().from('topic_labels').select('node_id,name').eq('locale', locale),
    )
      .then(setTopicNames)
      .catch(() => {})
  }, [locale])
  const expected = useRef(0),
    lastRead = useRef(0)
  const [url, setUrl] = useState(''),
    [title, setTitle] = useState(''),
    [channel, setChannel] = useState(''),
    [length, setLength] = useState(''),
    [start, setStart] = useState('0'),
    [end, setEnd] = useState('30')
  const [topic, setTopic] = useState(homeNode || fragments.find((f) => f.node_id)?.node_id || '')
  const [history, setHistory] = useState<
      { id: number; revision: number; cues: Cue[]; recorded_at: string }[]
    >([]),
    [restoreDraft, setRestoreDraft] = useState<Cue[]>()
  useEffect(() => {
    let active = true
    loadTVTrack(program, fragments, track, locale)
      .then((edition) => {
        if (active) {
          expected.current = edition.revision
          lastRead.current = edition.revision
          setInitial(edition.cues)
        }
      })
      .catch((e) => setError(e.message))
    return () => {
      active = false
    }
  }, [program, track, locale])
  async function load(target: string) {
    const edition = await loadTVTrack(program, sections, target, locale)
    if (target === track) lastRead.current = edition.revision
    return edition.cues
  }
  async function publish(_base: Cue[], rows: Cue[]) {
    setReview(undefined)
    expected.current = await result<number>(
      db().rpc('save_tv_track', {
        p_program: program,
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
    await saveLayout(next)
  }
  async function trim(section: Fragment, start: number, end: number) {
    if (busy) return
    await saveLayout(
      sections.map((f) =>
        f.id === section.id ? { ...f, start_seconds: start, end_seconds: end } : f,
      ),
    )
  }
  async function saveLayout(next: Fragment[]) {
    if (busy || !layoutReady) return
    setReview(undefined)
    keepLocal(next)
    if (!admin) {
      setError('Draft saved on this device. Join as the TV owner to save it online.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await result(
        db().rpc('save_tv_layout', {
          p_program: program,
          p_expected: publishedSections.current,
          p_sections: next,
          p_title: programTitle,
        }),
      )
      setSavedTitle(programTitle)
      publishedSections.current = next
      localStorage.removeItem(layoutKey)
      setLocalLayout(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function publishLayout() {
    await saveLayout(sections)
  }
  async function reviewEdition() {
    if (!admin || busy || localLayout) return
    setBusy(true)
    setError('')
    setReview(undefined)
    try {
      await result(
        db().rpc('save_tv_layout', {
          p_program: program,
          p_expected: publishedSections.current,
          p_sections: sections,
          p_title: programTitle,
        }),
      )
      setSavedTitle(programTitle)
      setReview(
        await result<EditionPreview>(db().rpc('tv_edition_preview', { p_program: program })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  // The server rejects the publish if anything differs from the reviewed snapshot.
  async function publishEdition() {
    if (!admin || busy || !review) return
    setBusy(true)
    setError('')
    try {
      const id = await result<string>(
        db().rpc('publish_tv_edition', {
          p_program: program,
          p_fingerprint: review.fingerprint,
        }),
      )
      setEditionLink(`#/tv/program/${program}?edition=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReview(undefined)
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
          p_program: program,
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
        db().rpc('tv_program_view', { p_program: program, p_locale: locale }),
      )
      publishedSections.current = fresh.fragments
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
  const available = pool.filter((f) => !sections.some((s) => s.id === f.id))
  return (
    <div>
      <div className="se-toolbar">
        <label>
          TV name{' '}
          <input
            value={programTitle}
            maxLength={160}
            disabled={!admin || busy}
            onChange={(e) => setProgramTitle(e.target.value)}
          />
        </label>
        <button
          disabled={!admin || busy || !programTitle.trim()}
          onClick={() => void publishLayout()}
        >
          Save TV
        </button>
        <button
          disabled={!admin || busy || localLayout || !programTitle.trim()}
          onClick={() => void reviewEdition()}
        >
          Review stable edition…
        </button>
        <span role="status">
          {!layoutReady
            ? 'Loading…'
            : busy
              ? 'Saving…'
              : localLayout
                ? 'Draft on this device — not saved online'
                : programTitle !== savedTitle
                  ? 'Unsaved TV name'
                  : 'Saved online'}
        </span>
        {editionLink && <a href={editionLink}>Watch published edition ↗</a>}
      </div>
      {review && (
        <div className="notice" role="dialog" aria-label="Review stable edition">
          <p>
            Freeze “{review.title}” (revision {review.revision}) exactly as listed. Any change made
            before publishing cancels this review.
          </p>
          <ol>
            {review.sections.map((s) => (
              <li key={s.id}>
                {s.title}{' '}
                <small>
                  ({s.start_seconds}–{s.end_seconds}s)
                </small>
              </li>
            ))}
          </ol>
          <p>
            Subtitles:{' '}
            {review.tracks.length
              ? review.tracks.map((t) => `${t.track} · ${t.locale} (${t.cues} cues)`).join(', ')
              : 'none'}
          </p>
          <button disabled={busy} onClick={() => void publishEdition()}>
            Publish this edition
          </button>{' '}
          <button disabled={busy} onClick={() => setReview(undefined)}>
            Cancel
          </button>
        </div>
      )}
      <details
        className="tv-section-manager"
        open={sectionTools}
        onToggle={(e) => setSectionTools(e.currentTarget.open)}
      >
        <summary>Add video fragments & precise source times</summary>
        <h2>Video sections</h2>
        <p>
          Reorder with Move earlier / Move later, or Remove a section. Set each section’s start and
          end within its original video, then Save trim. Changes save immediately for this TV.
        </p>
        {!admin && (
          <p className="notice">
            {userId
              ? 'Only this TV’s owner or a site administrator can save its sequence.'
              : 'Join as the TV owner to save your changes online.'}{' '}
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
                disabled={busy || i === 0}
                aria-label={`Move section ${i + 1} up`}
                onClick={() => void move(i, -1)}
              >
                Move earlier
              </button>
              <button
                disabled={busy || i === sections.length - 1}
                aria-label={`Move section ${i + 1} down`}
                onClick={() => void move(i, 1)}
              >
                Move later
              </button>
              <button
                disabled={busy}
                aria-label={`Remove section ${i + 1}`}
                onClick={() => void saveLayout(sections.filter((x) => x.id !== f.id))}
              >
                Remove
              </button>
              <SectionTiming
                section={f}
                disabled={busy}
                save={(start, end) => void trim(f, start, end)}
              />
            </li>
          ))}
        </ol>
        <form
          className="se-toolbar"
          onSubmit={(e) => {
            e.preventDefault()
            const chosen = available.find((f) => f.id === poolChoice)
            if (chosen) void saveLayout([...sections, chosen]).then(() => setPoolChoice(''))
          }}
        >
          <label>
            Add from this topic{' '}
            <select value={poolChoice} onChange={(e) => setPoolChoice(e.target.value)}>
              <option value="">
                {available.length ? 'Choose an excerpt…' : 'Every excerpt is already included'}
              </option>
              {available.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title} ({f.start_seconds}–{f.end_seconds}s)
                </option>
              ))}
            </select>
          </label>
          <button disabled={!admin || busy || localLayout || !poolChoice}>Add to TV</button>
        </form>
        <form
          className="se-toolbar"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <fieldset className="se-toolbar tv-add-section" disabled={!admin || busy || localLayout}>
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
                {Array.from(
                  new Set([homeNode, ...sections.map((f) => f.node_id)].filter(Boolean)),
                ).map((id) => (
                  <option key={id} value={id!}>
                    {id === homeNode
                      ? 'This selection’s topic'
                      : topicNames.find((t) => t.node_id === id)?.name || 'Selected section topic'}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy}>Add video section</button>
          </fieldset>
        </form>
      </details>
      {localLayout && (
        <p className="notice">
          Local sequence draft saved on this device.{' '}
          {admin && (
            <button disabled={busy} onClick={() => void publishLayout()}>
              Publish video changes
            </button>
          )}{' '}
          <button
            onClick={() => {
              localStorage.removeItem(layoutKey)
              setLocalLayout(false)
              setSections(publishedSections.current)
              onLayoutSaved(publishedSections.current)
            }}
          >
            Discard local sequence changes
          </button>
        </p>
      )}
      <p className="video-lane-help">
        <button onClick={() => setSectionTools((v) => !v)}>
          + Add video fragment / precise trim
        </button>{' '}
        Video fragments are on the blue lane above the subtitles. Drag a block to reorder; drag its
        edges to trim. Click a block to preview.{' '}
        {!admin && 'Join as the TV owner to save video changes online.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {initial ? (
        <SubtitleEditor
          clip={{
            id: `program-${program}`,
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
            layoutDisabled: busy || !layoutReady,
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
                      .from('tv_program_history')
                      .select('id,revision,cues,recorded_at')
                      .eq('program_id', program)
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
