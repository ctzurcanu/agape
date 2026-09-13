import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db, result, type Cue, type Fragment } from './api'
import { Player } from './Player'
import { programSeek, programTimeline } from './utils'
import { retimeProgramCues } from './tvProgram'
import { VideoSectionLane } from './VideoSectionLane'
import { SubtitleWaveform } from './SubtitleWaveform'
import { Markdown } from './Markdown'
import {
  ordered,
  subtitleLanes,
  timestamp,
  parseTimestamp,
  parseSubtitles,
  exportSubtitles,
  cueProblems,
  subtitleChanges,
  type EditableCue,
} from './subtitles'
import './subtitle-editor.css'

function TimeInput({
  value,
  label,
  onChange,
}: {
  value: number
  label: string
  onChange: (n: number) => void
}) {
  const [text, setText] = useState(timestamp(value))
  useEffect(() => setText(timestamp(value)), [value])
  return (
    <input
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        try {
          const n = parseTimestamp(text)
          onChange(n)
          e.target.setCustomValidity('')
        } catch {
          e.target.setCustomValidity('Use hh:mm:ss.mmm or seconds')
          e.target.reportValidity()
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
export function SubtitleEditor({
  clip,
  track,
  locale,
  userId,
  cues,
  canEdit,
  onSaved,
  history,
  signIn,
  program,
}: {
  program?: {
    layoutDisabled: boolean
    moveSection: (from: number, to: number) => void
    trimSection: (section: Fragment, start: number, end: number) => void
    revision: number
    resumeRevision: (revision: number) => void
    sections: Fragment[]
    load: (track: string) => Promise<Cue[]>
    publish: (base: Cue[], rows: Cue[]) => Promise<Cue[]>
    acceptLatest: () => void
    restoreDraft?: Cue[]
  }
  clip: Fragment
  track: string
  locale: string
  userId?: string
  cues: Cue[]
  canEdit: boolean
  onSaved: () => void
  history: ReactNode
  signIn: () => void
}) {
  const previousSections = useRef(program?.sections)
  useEffect(() => {
    if (program && previousSections.current && previousSections.current !== program.sections) {
      const before = previousSections.current
      setRows((r) => retimeProgramCues(r, before, program.sections))
      setBase((r) => retimeProgramCues(r, before, program.sections))
      setUndo([])
      setRedo([])
      previousSections.current = program.sections
    }
  }, [program?.sections])
  useEffect(() => {
    if (program?.restoreDraft) change(program.restoreDraft)
  }, [program?.restoreDraft])
  const start = Number(clip.start_seconds),
    end = Number(clip.end_seconds),
    duration = end - start
  const storageKey = `agape.subtitle-workspace:${userId || 'guest'}:${program ? clip.id : clip.curated ? clip.id : clip.video_id}:${track}:${locale}`
  const [initial] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (v && Array.isArray(v.rows) && Array.isArray(v.base))
        return program && Array.isArray(v.sections)
          ? {
              version: typeof v.version === 'number' ? v.version : undefined,
              rows: retimeProgramCues(v.rows, v.sections, program.sections),
              base: retimeProgramCues(v.base, v.sections, program.sections),
            }
          : (v as { rows: EditableCue[]; base: EditableCue[]; version?: number })
    } catch {}
    return { rows: cues, base: cues, version: program?.revision }
  })
  useEffect(() => {
    if (program && initial.version !== undefined) program.resumeRevision(initial.version)
  }, [])
  const [rows, setRows] = useState<EditableCue[]>(initial.rows),
    [base, setBase] = useState<EditableCue[]>(initial.base)
  const [undo, setUndo] = useState<EditableCue[][]>([]),
    [redo, setRedo] = useState<EditableCue[][]>([])
  const [selected, setSelected] = useState(initial.rows[0]?.id || '')
  const [time, setTime] = useState(start),
    [seek, setSeek] = useState<{ time: number; request: number }>()
  const [playing, setPlaying] = useState(false),
    [playback, setPlayback] = useState({ playing: false, rate: 1, request: 0 })
  const [pauseTyping, setPauseTyping] = useState(true),
    [loop, setLoop] = useState(false),
    [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState(''),
    [replacement, setReplacement] = useState(''),
    [shift, setShift] = useState('0')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [stored, setStored] = useState(false)
  const [copyTrack, setCopyTrack] = useState('version1')
  const [importMode, setImportMode] = useState('append'),
    [relative, setRelative] = useState(false)
  const [latest, setLatest] = useState<Cue[]>()
  const [help, setHelp] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null),
    drag = useRef<{ id: string; edge: string; x: number; width: number; rows: EditableCue[] }>(null)
  const dirty = subtitleChanges(base, rows).length > 0
  const sorted = ordered(rows),
    cue = rows.find((c) => c.id === selected),
    problems = cueProblems(rows, start, end)
  const lanes = subtitleLanes(rows)
  const request = useRef(0)
  function jump(t: number) {
    const n = Math.min(end, Math.max(start, t))
    setTime(n)
    setSeek({ time: n, request: ++request.current })
  }
  function play(value: boolean) {
    setPlayback((p) => ({ ...p, playing: value, request: p.request + 1 }))
    setPlaying(value)
  }
  function change(next: EditableCue[]) {
    if (busy) return
    setUndo((h) => [...h.slice(-99), rows])
    setRedo([])
    setRows(next)
    setMessage('')
  }
  function patch(id: string, values: Partial<EditableCue>) {
    change(rows.map((c) => (c.id === id ? { ...c, ...values } : c)))
  }
  function undoEdit() {
    if (busy || !undo.length) return
    setRedo((h) => [...h, rows])
    setRows(undo[undo.length - 1])
    setUndo((h) => h.slice(0, -1))
  }
  function redoEdit() {
    if (busy || !redo.length) return
    setUndo((h) => [...h, rows])
    setRows(redo[redo.length - 1])
    setRedo((h) => h.slice(0, -1))
  }
  useEffect(() => {
    if (!dirty) {
      setRows(cues)
      setBase(cues)
    }
  }, [cues])
  useEffect(() => {
    try {
      if (dirty)
        localStorage.setItem(
          storageKey,
          JSON.stringify({ base, rows, sections: program?.sections, version: program?.revision }),
        )
      else localStorage.removeItem(storageKey)
      setStored(dirty)
    } catch {
      setStored(false)
    }
  }, [rows, base, storageKey, dirty, program?.sections])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && !stored) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, stored])
  function add() {
    const id = crypto.randomUUID(),
      t = Math.min(time, end - 0.1)
    change([
      ...rows,
      {
        id,
        video_id: clip.video_id,
        locale,
        start_seconds: t,
        end_seconds: Math.min(end, t + 3),
        markdown: '',
      },
    ])
    setSelected(id)
  }
  function split() {
    if (!cue || time <= cue.start_seconds || time >= cue.end_seconds) return
    const pos = textRef.current?.selectionStart || Math.floor(cue.markdown.length / 2)
    const id = crypto.randomUUID()
    change([
      ...rows.filter((c) => c.id !== cue.id),
      { ...cue, end_seconds: time, markdown: cue.markdown.slice(0, pos).trim() },
      {
        id,
        video_id: clip.video_id,
        locale,
        start_seconds: time,
        end_seconds: cue.end_seconds,
        markdown: cue.markdown.slice(pos).trim(),
      },
    ])
    setSelected(id)
  }
  function merge() {
    if (!cue) return
    const next = sorted[sorted.findIndex((c) => c.id === cue.id) + 1]
    if (!next) return
    change(
      rows
        .filter((c) => c.id !== next.id)
        .map((c) =>
          c.id === cue.id
            ? {
                ...c,
                end_seconds: Math.max(c.end_seconds, next.end_seconds),
                markdown: c.markdown + '\n' + next.markdown,
              }
            : c,
        ),
    )
  }
  function decorate(left: string, right = left) {
    if (!cue) return
    const el = textRef.current,
      a = el?.selectionStart || 0,
      b = el?.selectionEnd || a
    patch(cue.id, {
      markdown:
        cue.markdown.slice(0, a) + left + cue.markdown.slice(a, b) + right + cue.markdown.slice(b),
    })
    el?.focus()
  }
  const conflicts = latest
    ? subtitleChanges(base, rows).filter(
        (c) =>
          c.operation !== 'insert' && latest.find((n) => n.id === c.id)?.revision !== c.expected,
      )
    : []
  async function loadLatest() {
    try {
      setLatest(
        program
          ? await program.load(track)
          : await result<Cue[]>(
              db()
                .from(clip.curated ? 'tv_subtitle_cue' : 'subtitle_cues')
                .select('*')
                .eq(
                  clip.curated ? 'fragment_id' : 'video_id',
                  clip.curated ? clip.id : clip.video_id,
                )
                .eq('track', track)
                .eq('locale', locale),
            ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  function resolveConflict(id: string, keepDraft: boolean) {
    const current = latest?.find((c) => c.id === id)
    setBase((b) => [...b.filter((c) => c.id !== id), ...(current ? [current] : [])])
    if (!keepDraft) change([...rows.filter((c) => c.id !== id), ...(current ? [current] : [])])
    else if (!current)
      change(
        rows.map((c) => (c.id === id ? { ...c, id: crypto.randomUUID(), revision: undefined } : c)),
      )
  }
  async function publish() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (problems.some((p) => p.errors.length))
        throw new Error('Fix timing and empty text errors before publishing.')
      const fresh = program
        ? await program.publish(base, rows)
        : await (async () => {
            await result(
              db().rpc('publish_subtitles', {
                p_source: clip.curated ? 'curated' : 'creator',
                p_context: clip.curated ? clip.id : clip.video_id,
                p_track: track,
                p_locale: locale,
                p_changes: subtitleChanges(base, rows),
              }),
            )
            return await result<Cue[]>(
              db()
                .from(clip.curated ? 'tv_subtitle_cue' : 'subtitle_cues')
                .select('*')
                .eq(
                  clip.curated ? 'fragment_id' : 'video_id',
                  clip.curated ? clip.id : clip.video_id,
                )
                .eq('track', track)
                .eq('locale', locale)
                .order('start_seconds'),
            )
          })()
      setRows(fresh)
      setBase(fresh)
      setUndo([])
      setRedo([])
      setLatest(undefined)
      setMessage('Published. Every change is recorded in revision history.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  function download(format: 'srt' | 'vtt') {
    const url = URL.createObjectURL(
      new Blob([exportSubtitles(rows, format)], { type: 'text/plain;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${clip.video_id}-${track}-${locale}.${format}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function copyAlternative() {
    setError('')
    try {
      const source = program
        ? await program.load(copyTrack)
        : await result<Cue[]>(
            db()
              .from(clip.curated ? 'tv_subtitle_cue' : 'subtitle_cues')
              .select('*')
              .eq(clip.curated ? 'fragment_id' : 'video_id', clip.curated ? clip.id : clip.video_id)
              .eq('locale', locale)
              .eq('track', copyTrack),
          )
      if (!source.length) throw new Error('That alternative has no cues.')
      change(source.map((c) => ({ ...c, id: crypto.randomUUID(), revision: undefined })))
      setMessage(
        'Copied into this draft. The source alternative is unchanged. Review before publishing.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  async function importFile(file: File) {
    setError('')
    try {
      if (file.size > 2000000) throw new Error('Use a subtitle file under 2 MB.')
      let imported = parseSubtitles(await file.text())
      if (relative)
        imported = imported.map((c) => ({
          ...c,
          start_seconds: c.start_seconds + start,
          end_seconds: c.end_seconds + start,
        }))
      const kept = imported
        .filter((c) => c.end_seconds > start && c.start_seconds < end)
        .map((c) => ({
          ...c,
          start_seconds: Math.max(start, c.start_seconds),
          end_seconds: Math.min(end, c.end_seconds),
        }))
      if (!kept.length)
        throw new Error('No cues intersect this excerpt. Check the timestamp origin.')
      change(importMode === 'replace' ? kept : [...rows, ...kept])
      setSelected(kept[0].id)
      setMessage(
        `Imported ${kept.length} cues into your draft. ${imported.length - kept.length} outside the excerpt were skipped. Review before publishing.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const previewTarget = program ? programSeek(program.sections, time) : undefined
  const previewSection = program && previewTarget ? program.sections[previewTarget.index] : clip
  const previewOffset =
    program && previewTarget
      ? programTimeline(program.sections).segments[previewTarget.index].offset
      : 0
  const previewCues = program
    ? rows
        .filter(
          (c) =>
            c.end_seconds > previewOffset &&
            c.start_seconds <
              previewOffset + previewSection.end_seconds - previewSection.start_seconds,
        )
        .map((c) => ({
          ...c,
          start_seconds: c.start_seconds - previewOffset + previewSection.start_seconds,
          end_seconds: c.end_seconds - previewOffset + previewSection.start_seconds,
        }))
    : rows
  const previewSeek = useMemo(
    () =>
      program
        ? {
            time:
              programSeek(program.sections, seek?.time ?? 0)?.time ?? previewSection.start_seconds,
            request: seek?.request || 0,
          }
        : seek,
    [program?.sections, seek, previewSection.id],
  )
  function select(c: EditableCue) {
    setSelected(c.id)
    jump(c.start_seconds)
  }
  return (
    <section
      className="subtitle-workspace"
      aria-label="Subtitle editing workspace"
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey
        if (mod && e.key === 's') {
          e.preventDefault()
          if (canEdit && dirty) void publish()
        } else if (mod && e.key === 'z') {
          e.preventDefault()
          if (e.shiftKey) redoEdit()
          else undoEdit()
        } else if (mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault()
          const i = sorted.findIndex((c) => c.id === selected),
            c = sorted[i + (e.key === 'ArrowDown' ? 1 : -1)]
          if (c) select(c)
        } else if (e.shiftKey && e.key === ' ') {
          e.preventDefault()
          play(!playing)
        } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault()
          jump(time + (e.key === 'ArrowLeft' ? -0.1 : 0.1))
        }
      }}
    >
      <header className="se-heading">
        <div>
          <h2>{program ? 'TV program studio' : 'Subtitle studio'}</h2>
          <small>
            {track.replace('version', 'Version ')} · {locale === 'fr' ? 'French' : 'English'} ·{' '}
            {rows.length} cues
          </small>
        </div>
        <span role="status">
          {busy
            ? 'Publishing…'
            : dirty
              ? stored
                ? 'Draft saved on this device'
                : 'Unsaved draft'
              : 'All changes published'}
        </span>
        <button
          disabled={!canEdit || !dirty || busy || problems.some((p) => p.errors.length)}
          onClick={() => void publish()}
        >
          Publish changes
        </button>
      </header>
      {error && (
        <p role="alert" className="notice">
          {error} Your draft is kept.{' '}
          <button disabled={busy} onClick={() => void loadLatest()}>
            Compare with latest published subtitles
          </button>
        </p>
      )}
      {program && latest && (
        <section className="se-conflicts">
          <p>The whole TV subtitle version is compared together.</p>
          <button
            onClick={() => {
              program.acceptLatest()
              setBase(latest)
              change(latest)
              setLatest(undefined)
            }}
          >
            Use latest published version
          </button>
          <button
            onClick={() => {
              program.acceptLatest()
              setBase(latest)
              setLatest(undefined)
            }}
          >
            Keep my whole draft for next publish
          </button>
        </section>
      )}
      {!program && conflicts.length > 0 && (
        <section className="se-conflicts" aria-label="Resolve subtitle conflicts">
          <h3>Review conflicting changes</h3>
          {conflicts.map((c) => (
            <article key={c.id}>
              <p>Published: {latest?.find((n) => n.id === c.id)?.markdown || '(removed)'}</p>
              <p>Your draft: {c.operation === 'delete' ? '(remove cue)' : c.markdown}</p>
              <button onClick={() => resolveConflict(c.id, false)}>Use published version</button>
              <button onClick={() => resolveConflict(c.id, true)}>
                Keep my change for next publish
              </button>
            </article>
          ))}
        </section>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!canEdit && (
        <p className="notice">
          {userId
            ? 'Only the verified creator can publish this video’s subtitles.'
            : 'You can try the editor and export a draft. Join to publish.'}{' '}
          {!userId && <button onClick={signIn}>Join</button>}
        </p>
      )}
      <div className="se-main">
        <div className="se-cues">
          <div className="se-toolbar">
            <button disabled={busy} onClick={add}>
              + Cue
            </button>
            <button disabled={!undo.length || busy} onClick={undoEdit}>
              Undo
            </button>
            <button disabled={!redo.length || busy} onClick={redoEdit}>
              Redo
            </button>
            <input
              aria-label="Find subtitle text"
              placeholder="Find text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="se-cue-list" role="group" aria-label="Subtitle cues">
            {sorted
              .filter((c) => !query || c.markdown.toLowerCase().includes(query.toLowerCase()))
              .map((c, i) => (
                <button
                  className={`se-cue ${selected === c.id ? 'selected' : ''} ${time >= c.start_seconds && time < c.end_seconds ? 'active' : ''}`}
                  key={c.id}
                  onClick={() => select(c)}
                >
                  <small>
                    {i + 1} · {timestamp(c.start_seconds)} → {timestamp(c.end_seconds)}
                  </small>
                  <span>{c.markdown || 'Empty subtitle'}</span>
                  {problems.find((p) => p.id === c.id) && (
                    <small className="se-warning">
                      {[
                        ...problems.find((p) => p.id === c.id)!.errors,
                        ...problems.find((p) => p.id === c.id)!.warnings,
                      ].join(' · ')}
                    </small>
                  )}
                </button>
              ))}
            {!rows.length && <p>Add a cue at the playhead, or import a subtitle file.</p>}
          </div>
        </div>
        <div className="se-preview">
          <Player
            key={previewSection.id}
            video={previewSection.video_id}
            start={previewSection.start_seconds}
            end={previewSection.end_seconds}
            cues={previewCues}
            captionMode="custom"
            overlayCaptions
            seek={previewSeek}
            playback={playback}
            onPlaying={setPlaying}
            onTime={(t) => {
              const programTime = program
                ? previewOffset +
                  Math.max(
                    0,
                    Math.min(
                      previewSection.end_seconds - previewSection.start_seconds,
                      t - previewSection.start_seconds,
                    ),
                  )
                : t
              setTime(programTime)
              if (loop && cue && programTime >= cue.end_seconds && playing) jump(cue.start_seconds)
            }}
            onEnd={() => {
              if (loop && cue) {
                jump(cue.start_seconds)
                play(true)
              } else if (
                program &&
                previewTarget &&
                previewTarget.index < program.sections.length - 1
              ) {
                jump(previewOffset + previewSection.end_seconds - previewSection.start_seconds)
                play(true)
              } else play(false)
            }}
          />
          <div className="se-toolbar">
            <button onClick={() => jump(time - 1)} aria-label="Back one second">
              −1s
            </button>
            <button onClick={() => play(!playing)}>{playing ? 'Pause' : 'Play'}</button>
            <button onClick={() => jump(time + 1)} aria-label="Forward one second">
              +1s
            </button>
            <output>{timestamp(time)}</output>
            <select
              aria-label="Playback speed"
              value={playback.rate}
              onChange={(e) =>
                setPlayback((p) => ({
                  ...p,
                  playing,
                  rate: +e.target.value,
                  request: p.request + 1,
                }))
              }
            >
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />{' '}
              Loop cue
            </label>
          </div>
        </div>
      </div>
      <SubtitleWaveform start={start} end={end} onSeek={jump} />
      <div className="se-timeline-header">
        <label>
          Zoom{' '}
          <input
            aria-label="Timeline zoom"
            type="range"
            min="1"
            max="12"
            step="1"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <small>
          Drag cue bodies to move; drag their edges to trim.{' '}
          {program
            ? 'Times are from the start of the TV program.'
            : 'Times are from the source video.'}
        </small>
      </div>
      <div className="se-timeline-scroll">
        <div
          className={`se-timeline ${program ? 'with-video-lane' : ''}`}
          style={{ width: `${zoom * 100}%` }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const c = d.rows.find((c) => c.id === d.id)!
            let delta = Math.round(((e.clientX - d.x) / d.width) * duration * 100) / 100
            let a = c.start_seconds,
              b = c.end_seconds
            if (d.edge === 'move') {
              delta = Math.max(start - a, Math.min(end - b, delta))
              a += delta
              b += delta
            } else if (d.edge === 'start') a = Math.max(start, Math.min(b - 0.1, a + delta))
            else b = Math.min(end, Math.max(a + 0.1, b + delta))
            setRows(
              d.rows.map((c) => (c.id === d.id ? { ...c, start_seconds: a, end_seconds: b } : c)),
            )
          }}
          onPointerUp={() => {
            const completedDrag = drag.current
            if (completedDrag) {
              drag.current = null
              setUndo((h) => [...h.slice(-99), completedDrag.rows])
              setRedo([])
            }
          }}
          onPointerCancel={() => {
            if (drag.current) {
              setRows(drag.current.rows)
              drag.current = null
            }
          }}
        >
          <input
            aria-label="Subtitle playhead"
            className="se-scrubber"
            type="range"
            min={start}
            max={end}
            step="0.01"
            value={Math.min(end, Math.max(start, time))}
            onChange={(e) => jump(+e.target.value)}
          />
          {program && (
            <VideoSectionLane
              sections={program.sections}
              disabled={busy || program.layoutDisabled}
              onMove={program.moveSection}
              onTrim={program.trimSection}
              onSelect={jump}
            />
          )}
          <div className="se-ruler">
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i}>{timestamp(start + (duration * i) / 10).slice(3, 8)}</span>
            ))}
          </div>
          {sorted.map((c, i) => (
            <div
              key={c.id}
              className={`se-block ${selected === c.id ? 'selected' : ''}`}
              style={{
                left: `${((c.start_seconds - start) / duration) * 100}%`,
                width: `${((c.end_seconds - c.start_seconds) / duration) * 100}%`,
                top: (program ? 74 : 42) + (lanes.get(c.id) || 0) * 27,
                zIndex: selected === c.id ? 2 : 1,
              }}
              onPointerDown={(e) => {
                if (busy) return
                const edge = (e.target as HTMLElement).dataset.edge || 'move'
                e.currentTarget.parentElement!.setPointerCapture(e.pointerId)
                drag.current = {
                  id: c.id,
                  edge,
                  x: e.clientX,
                  width: e.currentTarget.parentElement!.getBoundingClientRect().width,
                  rows,
                }
                setSelected(c.id)
              }}
            >
              <button
                data-edge="start"
                aria-label={`Trim start of cue ${i + 1}`}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    patch(c.id, {
                      start_seconds: Math.max(
                        start,
                        Math.min(
                          c.end_seconds - 0.1,
                          c.start_seconds + (e.key === 'ArrowLeft' ? -0.1 : 0.1),
                        ),
                      ),
                    })
                  }
                }}
              />{' '}
              <button className="se-block-text" onClick={() => select(c)}>
                {c.markdown || '…'}
              </button>
              <button
                data-edge="end"
                aria-label={`Trim end of cue ${i + 1}`}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    patch(c.id, {
                      end_seconds: Math.min(
                        end,
                        Math.max(
                          c.start_seconds + 0.1,
                          c.end_seconds + (e.key === 'ArrowLeft' ? -0.1 : 0.1),
                        ),
                      ),
                    })
                  }
                }}
              />
            </div>
          ))}
          <div className="se-playhead" style={{ left: `${((time - start) / duration) * 100}%` }} />
        </div>
      </div>
      <fieldset className="se-edit" disabled={busy}>
        {cue ? (
          <>
            <div className="se-toolbar">
              <TimeInput
                label="Cue start"
                value={cue.start_seconds}
                onChange={(n) => patch(cue.id, { start_seconds: n })}
              />
              <button onClick={() => patch(cue.id, { start_seconds: time })}>Start here</button>
              <TimeInput
                label="Cue end"
                value={cue.end_seconds}
                onChange={(n) => patch(cue.id, { end_seconds: n })}
              />
              <button onClick={() => patch(cue.id, { end_seconds: time })}>End here</button>
              <button
                onClick={() => {
                  jump(cue.start_seconds)
                  play(true)
                }}
              >
                Preview cue
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={pauseTyping}
                  onChange={(e) => setPauseTyping(e.target.checked)}
                />{' '}
                Pause while typing
              </label>
            </div>
            <div className="se-text-row">
              <textarea
                ref={textRef}
                aria-label="Selected subtitle text"
                value={cue.markdown}
                maxLength={2000}
                onChange={(e) => {
                  if (pauseTyping) play(false)
                  patch(cue.id, { markdown: e.target.value })
                }}
              />
              <div className="se-text-preview">
                <Markdown text={cue.markdown} />
              </div>
            </div>
            <div className="se-toolbar">
              <button onClick={() => decorate('**')}>Bold</button>
              <button onClick={() => decorate('*')}>Italic</button>
              <button onClick={() => decorate('[', '](https://example.com)')}>Link</button>
              <button
                disabled={time <= cue.start_seconds || time >= cue.end_seconds}
                onClick={split}
              >
                Split at playhead
              </button>
              <button disabled={sorted.at(-1)?.id === cue.id} onClick={merge}>
                Merge next
              </button>
              <button
                onClick={() => {
                  change(rows.filter((c) => c.id !== cue.id))
                  setSelected('')
                }}
              >
                Delete cue
              </button>
              <small>
                {cue.markdown.length} characters ·{' '}
                {(cue.markdown.length / (cue.end_seconds - cue.start_seconds)).toFixed(1)} chars/s
              </small>
            </div>
          </>
        ) : (
          <p>Select a cue to edit text and timing.</p>
        )}
      </fieldset>
      <details className="se-tools">
        <summary>Files, bulk edits & revision history</summary>
        <fieldset disabled={busy}>
          <div className="se-toolbar">
            <select
              aria-label="Copy from alternative"
              value={copyTrack}
              onChange={(e) => setCopyTrack(e.target.value)}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={`version${n}`}>
                  Version {n}
                </option>
              ))}
            </select>
            <button disabled={copyTrack === track} onClick={() => void copyAlternative()}>
              Copy alternative into draft
            </button>
            <button onClick={() => download('srt')}>Export SRT</button>
            <button onClick={() => download('vtt')}>Export VTT</button>
            <select
              aria-label="Import mode"
              value={importMode}
              onChange={(e) => setImportMode(e.target.value)}
            >
              <option value="append">Append to draft</option>
              <option value="replace">Replace draft</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={relative}
                onChange={(e) => setRelative(e.target.checked)}
              />{' '}
              File starts at excerpt zero
            </label>
            <label>
              Import SRT/VTT
              <input
                aria-label="Import subtitles"
                type="file"
                accept=".srt,.vtt,text/vtt,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importFile(file)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          <p>
            Imports are drafts. Cues crossing excerpt boundaries are trimmed. Exports preserve
            Markdown and web links as text.
          </p>
          <div className="se-toolbar">
            <input
              aria-label="Replacement text"
              placeholder="Replace matching text with…"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
            <button
              disabled={!query}
              onClick={() =>
                change(
                  rows.map((c) => ({ ...c, markdown: c.markdown.split(query).join(replacement) })),
                )
              }
            >
              Replace all (case sensitive)
            </button>
            <input
              aria-label="Shift seconds"
              type="number"
              step="0.1"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
            />
            <button
              onClick={() => {
                const n = Number(shift)
                if (Number.isFinite(n))
                  change(
                    rows.map((c) => ({
                      ...c,
                      start_seconds: c.start_seconds + n,
                      end_seconds: c.end_seconds + n,
                    })),
                  )
              }}
            >
              Shift all timings
            </button>
          </div>
        </fieldset>
        {history}
      </details>
      <div className="se-footer">
        <button className="plain" onClick={() => setHelp((v) => !v)}>
          Keyboard shortcuts
        </button>
        <span>
          {problems.filter((p) => p.errors.length).length} errors ·{' '}
          {problems.filter((p) => p.warnings.length).length} cue warnings
        </span>
        {dirty && (
          <button
            onClick={() => {
              change(base)
              setMessage('Returned to the last loaded published version. Undo recovers your draft.')
            }}
            disabled={busy}
          >
            Discard draft
          </button>
        )}
      </div>
      {help && (
        <p>
          Shift+Space: play/pause · Ctrl/⌘+S: publish · Ctrl/⌘+Z: undo · Ctrl/⌘+Shift+Z: redo ·
          Ctrl/⌘+↑/↓: previous/next cue · Alt+←/→: seek 0.1s · cue edge buttons: ←/→ to trim 0.1s.
        </p>
      )}
    </section>
  )
}
