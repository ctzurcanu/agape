import {
  createContext,
  useContext,
  useEffect,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import {
  browse,
  configured,
  db,
  errorMessage,
  result,
  supabase,
  type Browse,
  type Cue,
  type Topic,
  type Video,
  type VideoDetail,
} from './api'
import { Player } from './Player'
import { TVProgramEditor } from './TVProgramEditor'
import { SubtitleEditor } from './SubtitleEditor'
import { Markdown } from './Markdown'
import { timeLabel, videoId, programTimeline, programSeek } from './utils'

interface Context {
  session: Session | null
  admin: boolean
  locale: string
  revision: number
  refresh: () => void
  signIn: () => Promise<void>
}
const AppContext = createContext<Context>(null!)
const useApp = () => useContext(AppContext)
function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setData(undefined)
    setError('')
    load()
      .then((value) => {
        if (active) setData(value)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
    return () => {
      active = false
    }
    // Each caller provides the complete query key, including session revisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error }
}
function useWork() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, message, setMessage, run }
}
function Feedback({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
    </>
  )
}
function Loading({ error }: { error: string }) {
  const { refresh } = useApp()
  return error ? (
    <div className="empty">
      <h2>We couldn’t load this page.</h2>
      <p>{error}</p>
      <button onClick={refresh}>Try again</button>
    </div>
  ) : (
    <div className="loading" role="status">
      Gathering ideas<span>•••</span>
    </div>
  )
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-symbol">✳</span>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
    </div>
  )
}
function topicUrl(id?: string | null) {
  return id ? `/topic/${id}` : '/'
}
function watchUrl(id: string, topic?: string | null) {
  return `/watch/${id}${topic ? `?topic=${topic}` : ''}`
}
function Breadcrumbs({ topics, rootOnly = false }: { topics: Topic[]; rootOnly?: boolean }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {!rootOnly && <Link to="/">All topics</Link>}
      {topics.map((t, i) => (
        <span key={t.node_id}>
          {(!rootOnly || i > 0) && ' / '}
          <Link to={topicUrl(t.node_id)}>{t.name}</Link>
        </span>
      ))}
    </nav>
  )
}
function VideoCard({ video, topic }: { video: Video; topic?: string | null }) {
  return (
    <Link className="video-card" to={watchUrl(video.video_id, topic)}>
      <div className="thumbnail">
        <img src={`https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`} alt="" loading="lazy" />
        <span>{timeLabel(video.duration_seconds)}</span>
      </div>
      <div className="video-copy">
        <h3>{video.title}</h3>
        <p>{video.channel_title}</p>
      </div>
    </Link>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null>(null),
    [admin, setAdmin] = useState(false)
  const [locale, setLocale] = useState(() => localStorage.getItem('agape.locale') || 'en')
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((v) => v + 1)
  const work = useWork(),
    location = useLocation()
  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setSession(data.session)
        if (error)
          void work.run(async () => {
            throw error
          })
      }
    })
    const { data } = supabase.auth.onAuthStateChange((_event, value) => {
      setSession(value)
      setRevision((v) => v + 1)
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    let active = true
    setAdmin(false)
    if (session)
      result<boolean>(db().rpc('is_admin'))
        .then((value) => {
          if (active) setAdmin(value)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [session?.user.id, revision])
  useEffect(() => {
    localStorage.setItem('agape.locale', locale)
    document.documentElement.lang = locale
  }, [locale])
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])
  async function signIn() {
    const settings = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(10000),
    })
    if (!settings.ok) throw new Error('Sign-in is temporarily unavailable. Please try again.')
    if (!(await settings.json()).external?.google)
      throw new Error('Google sign-in has not been enabled for this community yet.')
    const { error } = await db().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
        scopes: 'https://www.googleapis.com/auth/youtube.readonly',
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) throw error
  }
  return (
    <AppContext.Provider value={{ session, admin, locale, revision, refresh, signIn }}>
      <header className="header">
        <Link to="/" className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}images/agape.svg`} alt="" />
          agape
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Explore
          </NavLink>
          <NavLink to="/tv">
            Agape TV <span className="live-dot" />
          </NavLink>
          <NavLink to="/studio">Creator studio</NavLink>
          {admin && <ReviewLink />}
        </nav>
        <div className="account">
          <select
            aria-label="Content language"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
          <button
            className="button small"
            disabled={work.busy}
            onClick={() =>
              work.run(async () => {
                if (session) {
                  const { error } = await db().auth.signOut()
                  if (error) throw error
                } else await signIn()
              })
            }
          >
            {session ? 'Sign out' : 'Join'}
            <span>↗</span>
          </button>
        </div>
      </header>
      <main>
        <Feedback {...work} />
        {!configured ? (
          <Empty title="Connect your community">
            <p>Add the browser Supabase settings to .env.local, then restart the app.</p>
          </Empty>
        ) : (
          <Routes>
            <Route path="/" element={<Explore />} />
            <Route path="/topic/:node" element={<Explore />} />
            <Route path="/tv" element={<TV />} />
            <Route path="/tv/:node" element={<TV />} />
            <Route path="/tv/program/:program" element={<TV />} />
            <Route path="/watch/:video" element={<Watch />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/ballot/:ballot" element={<Ballot />} />
            <Route
              path="*"
              element={
                <Empty title="This page has wandered off.">
                  <Link to="/">Back to all topics →</Link>
                </Empty>
              }
            />
          </Routes>
        )}
      </main>
      <footer>
        <Link className="brand" to="/">
          agape
        </Link>
        <p>Good ideas grow in good company.</p>
        <span>Made for creators. Open to curiosity.</span>
      </footer>
    </AppContext.Provider>
  )
}

function Explore() {
  const { node } = useParams(),
    { locale, revision } = useApp()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || '',
    tag = params.get('tag') || '',
    descendants = params.get('scope') !== 'direct'
  const [search, setSearch] = useState(query)
  useEffect(() => {
    setSearch(query)
  }, [query])
  const { data, error } = useLoad(
    () => browse(node || null, locale, query, tag || null, descendants),
    [node, locale, query, tag, descendants, revision],
  )
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  if (!data) return <Loading error={error} />
  if (node && !data.node)
    return (
      <Empty title="Topic not found">
        <p>This topic may have been archived.</p>
        <Link to="/">Explore all topics →</Link>
      </Empty>
    )
  return (
    <>
      {node && <Breadcrumbs topics={data.breadcrumbs} />}
      <section className={`hero ${node ? 'compact' : ''}`}>
        <div>
          <div className="eyebrow">
            <span className="tiny-star">✳</span>
            {node ? 'FOLLOW YOUR CURIOSITY' : 'A COMMUNITY OF CREATORS'}
          </div>
          <h1>
            {data.node ? (
              data.node.name
            ) : (
              <>
                A world of ideas.
                <br />
                <em>People to explore it with.</em>
              </>
            )}
          </h1>
          <p>
            {data.node
              ? data.node.description ||
                'Explore the ideas, videos, and people connected to this topic.'
              : 'Discover videos through a growing map of knowledge. Find your people, share what you know, and see where curiosity takes you.'}
          </p>
          <div className="hero-actions">
            <Link className="button" to={node ? `/tv/${node}` : '/tv'}>
              <span>▷</span> Watch this community
            </Link>
            <button
              className="plain text-link"
              onClick={() =>
                document.getElementById('topics')?.scrollIntoView({
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'instant'
                    : 'smooth',
                })
              }
            >
              Explore the topics ↓
            </button>
          </div>
          {node && <TopicBallots node={node} />}
        </div>
        {!node && (
          <div className="idea-map" aria-hidden="true">
            <div className="orbit one" />
            <div className="orbit two" />
            <div className="orbit three" />
            <div className="map-center">✳</div>
            <span className="map-label label-one">a new perspective</span>
            <span className="map-label label-two">a shared interest</span>
            <span className="map-label label-three">an unexpected connection</span>
            <i className="map-dot dot-one" />
            <i className="map-dot dot-two" />
            <i className="map-dot dot-three" />
          </div>
        )}
      </section>
      <div className="workspace" id="topics">
        <aside className="sidebar">
          <div className="eyebrow">YOUR COMPASS</div>
          <h3>Follow a thread.</h3>
          <p>Every topic opens a door to something more.</p>
          <Link className={!node ? 'side-link selected' : 'side-link'} to="/">
            ◈ All topics
          </Link>
          {data.breadcrumbs.map((t) => (
            <Link
              className={`side-link ${t.node_id === node ? 'selected' : ''}`}
              key={t.node_id}
              to={topicUrl(t.node_id)}
            >
              ↳ {t.name}
            </Link>
          ))}
          {!!data.related.length && (
            <>
              <div className="eyebrow related-label">CONNECTED IDEAS</div>
              {data.related.map((t) => (
                <Link
                  className="side-link"
                  key={`${t.edge_type}-${t.node_id}`}
                  to={topicUrl(t.node_id)}
                >
                  ↗ {t.name}
                </Link>
              ))}
            </>
          )}
          <div className="sidebar-note">
            <span>✳</span>
            <h4>Something missing?</h4>
            <p>Help shape the map. Suggest a topic for the community.</p>
            <TopicForm parent={node || null} />
          </div>
        </aside>
        <section className="browse-content">
          <div className="section-heading">
            <div>
              <div className="eyebrow">THE MAP IS ALWAYS GROWING</div>
              <h2>
                {query
                  ? 'Search results'
                  : node
                    ? 'Go a little deeper'
                    : 'Find your starting point'}
              </h2>
            </div>
            <span className="count">
              {data.topics.length} topics{data.topics.length === 100 ? ' · first 100' : ''}
            </span>
          </div>
          <div className="filters">
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault()
                change('q', search)
              }}
            >
              <span>⌕</span>
              <input
                aria-label="Search topics and videos"
                placeholder="A topic, an idea, a new interest…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button type="submit">Search</button>
            </form>
            {!!data.tags.length && (
              <select
                aria-label="Filter by tag"
                value={tag}
                onChange={(e) => change('tag', e.target.value)}
              >
                <option value="">All tags</option>
                {data.tags.map((t) => (
                  <option key={t.tag_id} value={t.tag_id}>
                    {t.kind}: {t.name}
                  </option>
                ))}
              </select>
            )}
            {(query || tag) && (
              <button className="plain" onClick={() => setParams({})}>
                Clear filters
              </button>
            )}
          </div>
          {data.topics.length ? (
            <div className="topic-grid">
              {data.topics.map((t, i) => (
                <Link
                  className={`topic-card tone-${i % 4}`}
                  key={t.node_id}
                  to={topicUrl(t.node_id)}
                >
                  <div className="topic-top">
                    <span className="topic-icon">{['✳', '◈', '◎', '⌁'][i % 4]}</span>
                    <span>↗</span>
                  </div>
                  <h3>{t.name}</h3>
                  <p>{t.description || 'Discover the ideas and creators within.'}</p>
                  <div className="topic-bottom">
                    {t.child_count ? `${t.child_count} subtopics` : 'Explore topic'}
                    <span>→</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title={
                query || tag
                  ? 'No matches just yet.'
                  : node
                    ? 'You’ve reached a leaf of the map.'
                    : 'Every community begins with an idea.'
              }
            >
              <p>
                {query || tag
                  ? 'Try another search or clear the filters.'
                  : 'Suggest a topic to help this independent community grow.'}
              </p>
              <TopicForm parent={node || null} />
            </Empty>
          )}
          <div className="section-heading video-heading">
            <h2>From the community</h2>
            {node && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={descendants}
                  onChange={(e) => change('scope', e.target.checked ? '' : 'direct')}
                />
                Include subtopics
              </label>
            )}
          </div>
          {data.videos.length ? (
            <>
              <div className="video-grid">
                {data.videos.map((v) => (
                  <VideoCard key={v.video_id} video={v} topic={node} />
                ))}
              </div>
              {data.videos.length === 100 && (
                <p className="muted">
                  Showing the latest 100 videos. Explore a narrower topic for more.
                </p>
              )}
            </>
          ) : (
            <div className="quiet-empty">
              No approved videos here yet.{' '}
              <Link to={`/studio${node ? `?topic=${node}` : ''}`}>Share the first one ↗</Link>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function TopicForm({ parent }: { parent: string | null }) {
  const { session, admin, signIn, refresh } = useApp(),
    work = useWork()
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [description, setDescription] = useState('')
  if (!session)
    return (
      <>
        <button className="plain" disabled={work.busy} onClick={() => work.run(signIn)}>
          Sign in to suggest a topic ↗
        </button>
        <Feedback {...work} />
      </>
    )
  return (
    <>
      <button className="plain" onClick={() => setOpen(!open)}>
        {admin ? 'Create a topic' : 'Suggest a topic'} {open ? '−' : '+'}
      </button>
      {open && (
        <form
          className="stack-form"
          onSubmit={(e) => {
            e.preventDefault()
            void work.run(async () => {
              if (admin)
                await result(
                  db().rpc('create_topic', {
                    p_parent: parent,
                    p_name: name,
                    p_description: description,
                  }),
                )
              else
                await result(
                  db()
                    .from('node_proposal')
                    .insert({ parent_id: parent, name, description, proposed_by: session.user.id }),
                )
              setName('')
              setDescription('')
              work.setMessage(admin ? 'Topic created.' : 'Suggestion sent for review.')
              if (admin) refresh()
            })
          }}
        >
          <label>
            English name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button disabled={work.busy}>
            {work.busy ? 'Saving…' : admin ? 'Create topic' : 'Send suggestion'}
          </button>
        </form>
      )}
      <Feedback {...work} />
    </>
  )
}

type ProgramBrowse = Browse & {
  program?: {
    id: string
    title: string
    node_id: string | null
    owner_id: string
    revision: number
  }
}
function TV() {
  const { node: topicNode, program } = useParams(),
    { locale, revision, session, signIn } = useApp()
  const scope = program ? `program:${program}` : topicNode || 'root'
  const [tvParams] = useSearchParams()
  const editionId = tvParams.get('edition')
  // Edition links from before TVs had their own ids used the topic route.
  const legacyEdition = useLoad(
    async () =>
      !program && editionId
        ? result<{ program_id: string } | null>(
            db().from('tv_edition').select('program_id').eq('id', editionId).maybeSingle(),
          )
        : null,
    [program, editionId],
  )
  const edition = useLoad(
    async () =>
      program && editionId
        ? result<{
            title: string
            fragments: import('./api').Fragment[]
            tracks: { track: string; locale: string; cues: Cue[] }[]
          }>(
            db()
              .from('tv_edition')
              .select('title,fragments,tracks')
              .eq('id', editionId)
              .eq('program_id', program)
              .single(),
          )
        : null,
    [editionId, program],
  )
  const [subtitleTrack, setSubtitleTrack] = useState('version1')
  const [editorOpen, setEditorOpen] = useState(false)
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])
  const programInfo = useLoad(
    async () =>
      program
        ? result<{ title: string } | null>(
            db().from('tv_program').select('title').eq('id', program).maybeSingle(),
          )
        : null,
    [program, editorOpen],
  )
  const publishedEditions = useLoad(
    async () =>
      program
        ? result<{ id: string; title: string; published_at: string }[]>(
            db()
              .from('tv_edition')
              .select('id,title,published_at')
              .eq('program_id', program)
              .order('published_at', { ascending: false })
              .limit(50),
          )
        : [],
    [program, editorOpen],
  )
  useEffect(() => setEditorOpen(false), [editionId])
  const [cueRevision, setCueRevision] = useState(0)
  const [seek, setSeek] = useState<{ time: number; request: number }>()
  const [clipTime, setClipTime] = useState(0)
  const { data, error } = useLoad(
    () =>
      program
        ? result<ProgramBrowse | null>(
            db().rpc('tv_program_view', { p_program: program, p_locale: locale }),
          )
        : result<ProgramBrowse>(
            db().rpc('tv_browse', { p_node: topicNode || null, p_locale: locale }),
          ),
    [program, topicNode, locale, revision],
  )
  const node = program ? data?.program?.node_id || undefined : topicNode
  const [index, setIndex] = useState(0),
    [round, setRound] = useState(0),
    [started, setStarted] = useState(false)
  useEffect(() => {
    setIndex(0)
    setSeek(undefined)
    setClipTime(0)
    setRound(0)
    setStarted(false)
  }, [scope, revision, editionId])
  const [editedSections, setEditedSections] = useState<import('./api').Fragment[]>()
  useEffect(() => setEditedSections(undefined), [scope, revision])
  const sections = editionId
    ? edition.data?.fragments || []
    : editedSections || data?.fragments || []
  const clip = sections[index]
  const programPath = useLoad(async () => {
    if (node || !clip) return [] as Topic[]
    let topic = clip.node_id
    if (!topic) {
      const placements = await result<{ node_id: string }[]>(
        db()
          .from('fragment_topics')
          .select('node_id')
          .eq('fragment_id', clip.id)
          .eq('status', 'approved')
          .order('node_id')
          .limit(1),
      )
      topic = placements[0]?.node_id
    }
    return topic ? (await browse(topic, locale)).breadcrumbs : []
  }, [node, clip?.id, locale])
  const cues = useLoad(async () => {
    if (!clip) return [] as Cue[]
    if (editionId)
      return (
        edition.data?.tracks.find((t) => t.track === subtitleTrack && t.locale === locale)?.cues ||
        []
      )
        .filter((c) => c.section_id === clip.id)
        .map((c) => ({ ...c, track: subtitleTrack }))
    const savedTrack = program
      ? await result<{ cues: (Cue & { section_id: string })[] } | null>(
          db()
            .from('tv_program_track')
            .select('cues')
            .eq('program_id', program)
            .eq('track', subtitleTrack)
            .eq('locale', locale)
            .maybeSingle(),
        )
      : null
    if (savedTrack)
      return savedTrack.cues
        .filter((c) => c.section_id === clip.id)
        .map((c) => ({ ...c, track: subtitleTrack }))
    return result<Cue[]>(
      db()
        .from(clip.curated ? 'tv_subtitle_cue' : 'subtitle_cues')
        .select('*')
        .eq(clip.curated ? 'fragment_id' : 'video_id', clip.curated ? clip.id : clip.video_id)
        .eq('locale', locale)
        .order('start_seconds'),
    )
  }, [
    clip?.id,
    clip?.video_id,
    program,
    locale,
    cueRevision,
    subtitleTrack,
    editionId,
    edition.data,
  ])
  if (legacyEdition.data)
    return (
      <Navigate replace to={`/tv/program/${legacyEdition.data.program_id}?edition=${editionId}`} />
    )
  if (program && data === null)
    return (
      <Empty title="TV not found">
        <Link to="/tv">All Agape TV →</Link>
      </Empty>
    )
  if (program && editionId && !edition.data) return <Loading error={edition.error} />
  if (!data) return <Loading error={error} />
  if (topicNode && !data.node)
    return (
      <Empty title="Topic not found">
        <Link to="/tv">All Agape TV →</Link>
      </Empty>
    )
  function next() {
    setSeek(undefined)
    setClipTime(0)
    setIndex((i) => (i + 1) % sections.length)
    setRound((n) => n + 1)
  }
  const timeline = programTimeline(sections)
  const segment = timeline.segments[index]
  const elapsed = segment
    ? segment.offset + Math.max(0, Math.min(segment.duration, clipTime - segment.videoStart))
    : 0
  function seekProgram(position: number) {
    const target = programSeek(sections, position)
    if (!target) return
    setIndex(target.index)
    setClipTime(target.time)
    setSeek((previous) => ({ time: target.time, request: (previous?.request || 0) + 1 }))
  }
  return (
    <div className="page tv-page">
      <Breadcrumbs rootOnly topics={node ? data.breadcrumbs : programPath.data || []} />
      {!clip ? (
        <>
          <Empty
            title={
              program
                ? 'This TV has no video sections yet.'
                : 'The next great moment could be yours.'
            }
          >
            {program ? (
              <button onClick={() => setEditorOpen(true)}>Edit this TV</button>
            ) : (
              <>
                <p>There are no approved fragments in this topic yet.</p>
                <Link className="button" to="/studio">
                  Add your video fragment ↗
                </Link>
              </>
            )}
          </Empty>
          {!program && <TopicTVs node={topicNode} />}
        </>
      ) : (
        <div className="tv-layout">
          <section className="tv-stage">
            <Player
              key={`${clip.id}-${round}`}
              video={clip.video_id}
              start={Number(clip.start_seconds)}
              end={Number(clip.end_seconds)}
              overlayCaptions
              paused={editorOpen}
              captionMode={
                subtitleTrack === 'youtube' ? 'youtube' : subtitleTrack === 'off' ? 'off' : 'custom'
              }
              seek={seek}
              onTime={setClipTime}
              auto={started}
              cues={
                subtitleTrack === 'off' ? [] : cues.data?.filter((c) => c.track === subtitleTrack)
              }
              onEnd={() => {
                if (editorOpen) return
                setStarted(true)
                next()
              }}
            />
            <div className="tv-seek">
              <div className="tv-track">
                <input
                  id="tv-program-seek"
                  aria-label="TV program position"
                  type="range"
                  min="0"
                  max={timeline.total}
                  step="0.1"
                  value={elapsed}
                  aria-valuetext={`${timeLabel(elapsed)} of ${timeLabel(timeline.total)} — ${clip.title}`}
                  onChange={(e) => seekProgram(Number(e.target.value))}
                />
                <div className="tv-markers">
                  {timeline.segments.slice(1).map((s) => (
                    <button
                      type="button"
                      key={sections[s.index].id}
                      style={{ left: `${(100 * s.offset) / timeline.total}%` }}
                      title={`${timeLabel(s.offset)} — ${sections[s.index].title}`}
                      aria-label={`Jump to ${sections[s.index].title} at ${timeLabel(s.offset)}`}
                      onClick={() => seekProgram(s.offset)}
                    />
                  ))}
                </div>
              </div>
              <span className="tv-program-time">
                {timeLabel(elapsed)} / {timeLabel(timeline.total)}
              </span>
            </div>
            <Feedback error={cues.error} />
            <div className="now-playing">
              <div>
                <div className="eyebrow">
                  NOW PLAYING · {index + 1} / {sections.length}
                </div>
                <h2>{clip.title}</h2>
                <p>
                  {clip.channel_title} · {timeLabel(clip.start_seconds)}–
                  {timeLabel(clip.end_seconds)}
                </p>
              </div>
              <button
                onClick={() => {
                  setStarted(true)
                  next()
                }}
              >
                Skip →
              </button>
            </div>
            {program && editionId && (
              <p>
                {edition.data?.title} · Published edition ·{' '}
                <Link to={`/tv/program/${program}`}>Current TV</Link>
              </p>
            )}
            <div className="tv-tools">
              {programInfo.data && (
                <span>{editionId ? edition.data?.title : programInfo.data.title}</span>
              )}
              {!!publishedEditions.data?.length && (
                <label>
                  Edition{' '}
                  <select
                    aria-label="TV edition"
                    value={editionId || ''}
                    onChange={(e) => {
                      window.location.hash = `/tv/program/${program}${e.target.value ? `?edition=${e.target.value}` : ''}`
                    }}
                  >
                    <option value="">Current TV</option>
                    {publishedEditions.data.map((e, i) => (
                      <option key={e.id} value={e.id}>
                        {e.title} · {new Date(e.published_at).toLocaleString()} ·{' '}
                        {publishedEditions.data!.length - i}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label>
                <span className="tv-cc-label">[CC]</span>{' '}
                <select
                  aria-label="Alternative subtitle track"
                  value={subtitleTrack}
                  onChange={(e) => setSubtitleTrack(e.target.value)}
                >
                  <option value="youtube">YouTube</option>
                  <option value="version1">
                    Version 1 · {locale === 'fr' ? 'French' : 'English'}
                  </option>
                  <option value="version2">
                    Version 2 · {locale === 'fr' ? 'French' : 'English'}
                  </option>
                  <option value="version3">
                    Version 3 · {locale === 'fr' ? 'French' : 'English'}
                  </option>
                  <option value="off">Off</option>
                </select>
              </label>
              {program && (
                <button
                  disabled={Boolean(editionId)}
                  className="tv-edit-icon"
                  aria-label="Edit TV program and subtitles"
                  title="Edit TV program and subtitles"
                  onClick={() => {
                    if (subtitleTrack === 'off' || subtitleTrack === 'youtube')
                      setSubtitleTrack('version1')
                    setEditorOpen(true)
                  }}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="26"
                    height="26"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15z" />
                  </svg>
                </button>
              )}
              <select
                aria-label="Choose program video"
                value={index}
                onChange={(e) => seekProgram(timeline.segments[Number(e.target.value)].offset)}
              >
                {sections.map((f, i) => (
                  <option key={f.id} value={i}>
                    {i + 1}. {f.title}
                  </option>
                ))}
              </select>
            </div>
          </section>
          <aside className="queue">
            <div className="eyebrow">IN THIS LOOP</div>
            {sections.map((f, i) => (
              <button
                className={`queue-item ${i === index ? 'selected' : ''}`}
                key={f.id}
                onClick={() => {
                  setSeek(undefined)
                  setClipTime(0)
                  setIndex(i)
                  setRound((n) => n + 1)
                  setStarted(true)
                }}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{f.title}</strong>
                  <small>
                    {f.channel_title} · {timeLabel(Number(f.end_seconds) - Number(f.start_seconds))}
                  </small>
                </div>
                <span>▷</span>
              </button>
            ))}
            {!program && <TopicTVs node={topicNode} />}
          </aside>
        </div>
      )}
      {program && editorOpen && (
        <div
          className="tv-editor-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Edit TV program and subtitles"
        >
          <button autoFocus className="tv-editor-close" onClick={() => setEditorOpen(false)}>
            Close editor ×
          </button>
          <TVProgramEditor
            key={`${program}-${locale}-${subtitleTrack}-${session?.user.id || 'guest'}`}
            program={program}
            homeNode={data.program?.node_id ?? null}
            fragments={sections}
            track={subtitleTrack}
            locale={locale}
            userId={session?.user.id}
            signIn={() => void signIn()}
            onSaved={() => setCueRevision((n) => n + 1)}
            onLayoutSaved={(next) => {
              setEditedSections(next)
              setIndex(0)
              setSeek(undefined)
              setClipTime(0)
            }}
          />
        </div>
      )}
    </div>
  )
}

// Named TVs whose home is this topic; eligible creators and administrators can start one.
function TopicTVs({ node }: { node?: string }) {
  const { session, revision } = useApp()
  const navigate = useNavigate()
  const work = useWork()
  const [title, setTitle] = useState('')
  const tvs = useLoad(
    () =>
      result<
        {
          id: string
          title: string
          sections: number
          latest_edition: { id: string; published_at: string } | null
        }[]
      >(db().rpc('tv_programs', { p_node: node || null })),
    [node, revision],
  )
  const canCreate = useLoad(
    async () =>
      session ? result<boolean>(db().rpc('can_create_tv', { p_node: node || null })) : false,
    [node, session?.user.id],
  )
  return (
    <section className="topic-tvs" aria-label="TVs in this topic">
      <div className="eyebrow">TVS IN THIS TOPIC</div>
      {tvs.data?.map((tv) => (
        <Link key={tv.id} className="queue-item" to={`/tv/program/${tv.id}`}>
          <span>▷</span>
          <div>
            <strong>{tv.title}</strong>
            <small>
              {tv.sections} sections
              {tv.latest_edition &&
                ` · edition ${new Date(tv.latest_edition.published_at).toLocaleDateString()}`}
            </small>
          </div>
        </Link>
      ))}
      {tvs.data && !tvs.data.length && <p>No named TVs here yet.</p>}
      {canCreate.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void work.run(async () => {
              const id = await result<string>(
                db().rpc('create_tv_program', { p_node: node || null, p_title: title }),
              )
              navigate(`/tv/program/${id}`)
            })
          }}
        >
          <label>
            New TV name{' '}
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <button disabled={work.busy || !title.trim()}>Create a TV</button>
        </form>
      )}
      <Feedback error={tvs.error || canCreate.error || work.error} />
      <TopicBallots node={node} />
    </section>
  )
}

type BallotSummary = {
  id: string
  kind: string
  title: string
  topic: string
  node_id: string
  closes_at: string
  open: boolean
  entries: number
}
type VotingBudget = {
  videos: number
  subtitles: number
  comments: number
  fines: number
  a: number
  b: number
  c: number
  z: number
  earned: number
  committed: number
  available: number
}
type BallotEntry = {
  id: string
  position: number
  kind: string
  video_id: string | null
  edition_id: string | null
  program_id: string | null
  title: string
  channel_title: string | null
  duration_seconds: number | null
  published_at: string | null
  sections: number | null
  owner_is_me: boolean
}
type BallotView = {
  ballot: {
    id: string
    kind: string
    node_id: string
    topic: string
    title: string
    opens_at: string
    closes_at: string
    open: boolean
    eligible_voters: number
  }
  entries: BallotEntry[]
  me:
    | (VotingBudget & {
        eligible: boolean
        votes: { entry_id: string; explanation: string | null }[]
      })
    | null
  results: {
    entries: number
    provisional: boolean
    voters: number
    board: {
      entry_id: string
      rank: number
      points: number
      voters: number
      explanations: string[]
    }[]
  } | null
}
function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// Open and recent creator ballots for a topic subtree (all ballots when no topic is given).
function TopicBallots({ node }: { node?: string }) {
  const { revision } = useApp()
  const ballots = useLoad(
    () => result<BallotSummary[]>(db().rpc('ballot_list', { p_node: node || null })),
    [node, revision],
  )
  if (!ballots.data?.length) return null
  return (
    <section className="topic-ballots" aria-label="Creator ballots">
      <div className="eyebrow">CREATOR BALLOTS</div>
      <ul className="submission-list">
        {ballots.data.slice(0, 5).map((b) => (
          <li key={b.id}>
            <Link to={`/ballot/${b.id}`}>{b.title}</Link>{' '}
            <small>
              {b.kind === 'video' ? 'Videos' : 'TV editions'} · {plural(b.entries, 'work')} ·{' '}
              {b.open ? `open until ${new Date(b.closes_at).toLocaleString()}` : 'results'}
            </small>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Ballot() {
  const { ballot } = useParams(),
    { session, revision, refresh, signIn } = useApp(),
    work = useWork()
  const view = useLoad(
    () => result<BallotView | null>(db().rpc('ballot_view', { p_ballot: ballot })),
    [ballot, revision, session?.user.id],
  )
  const [notes, setNotes] = useState<Record<string, string>>({})
  if (view.data === null)
    return (
      <Empty title="Ballot not found">
        <Link to="/">Explore topics →</Link>
      </Empty>
    )
  if (!view.data) return <Loading error={view.error} />
  const { ballot: b, entries, me, results } = view.data
  const voted = new Map((me?.votes || []).map((v) => [v.entry_id, v]))
  const byId = new Map(entries.map((e) => [e.id, e]))
  const link = (e: BallotEntry) =>
    e.video_id
      ? watchUrl(e.video_id, b.node_id)
      : `/tv/program/${e.program_id}?edition=${e.edition_id}`
  function act(action: 'cast_vote' | 'withdraw_vote', entry: string) {
    void work.run(async () => {
      try {
        await result(
          db().rpc(
            action,
            action === 'cast_vote'
              ? {
                  p_ballot: b.id,
                  p_entry: entry,
                  p_explanation: notes[entry] ?? voted.get(entry)?.explanation ?? null,
                }
              : { p_ballot: b.id, p_entry: entry },
          ),
        )
        work.setMessage(
          action === 'cast_vote'
            ? 'Recommendation saved. Only you can see it until the ballot closes.'
            : 'Recommendation withdrawn; its point is available again.',
        )
      } finally {
        refresh()
      }
    })
  }
  return (
    <div className="page">
      <div className="eyebrow">
        {b.kind === 'video' ? 'VIDEO BALLOT' : 'TV EDITION BALLOT'} ·{' '}
        <Link to={topicUrl(b.node_id)}>{b.topic}</Link>
      </div>
      <h1>{b.title}</h1>
      <p className="muted">
        {b.open
          ? `Open until ${new Date(b.closes_at).toLocaleString()}. Recommendations and totals stay private until then.`
          : `Closed ${new Date(b.closes_at).toLocaleString()}.`}{' '}
        {plural(b.eligible_voters, 'eligible creator')} when it opened.
      </p>
      <Feedback {...work} />
      {results && (
        <section className="panel">
          <h2>Results</h2>
          {results.provisional && (
            <p className="notice">Provisional — fewer than 3 works were on this ballot.</p>
          )}
          <p className="muted">
            {plural(results.voters, 'creator')} recommended from {plural(results.entries, 'work')}.
          </p>
          {!results.board.length ? (
            <p className="muted">No recommendations were made.</p>
          ) : (
            <ol className="ballot-board">
              {results.board.map((r) => {
                const e = byId.get(r.entry_id)
                if (!e) return null
                return (
                  <li key={r.entry_id}>
                    <span className="rank">{r.rank}</span>
                    <div>
                      <Link to={link(e)}>
                        <strong>{e.title}</strong>
                      </Link>{' '}
                      <small>
                        {plural(r.points, 'point')} · {plural(r.voters, 'voter')}
                      </small>
                      {r.explanations.map((x, i) => (
                        <p key={i} className="muted small-copy">
                          “{x}”
                        </p>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      )}
      {b.open &&
        (!session ? (
          <p className="notice">
            Sign in as a creator to vote.{' '}
            <button disabled={work.busy} onClick={() => work.run(signIn)}>
              Join
            </button>
          </p>
        ) : !me?.eligible ? (
          <p className="notice">
            Only creators with a recently verified video approved in {b.topic} can vote on this
            ballot.
          </p>
        ) : (
          <p className="notice">
            {Number(me.available)} of {Number(me.earned)} voting points available. Each
            recommendation uses one point until its ballot closes.{' '}
            <Link to="/studio">How your budget is calculated</Link>
          </p>
        ))}
      <div className="ballot-entries">
        {entries.map((e) => {
          const mine = voted.get(e.id)
          return (
            <article className="review-item" key={e.id}>
              <div>
                {e.video_id && (
                  <Link to={link(e)}>
                    <img
                      className="review-thumbnail"
                      src={`https://i.ytimg.com/vi/${e.video_id}/mqdefault.jpg`}
                      alt=""
                      loading="lazy"
                    />
                  </Link>
                )}
                <h3>
                  <Link to={link(e)}>{e.title}</Link>
                </h3>
                <p className="muted">
                  {e.video_id
                    ? `${e.channel_title} · ${timeLabel(e.duration_seconds || 0)}`
                    : `Edition published ${dateLabel(e.published_at)} · ${plural(e.sections || 0, 'section')}`}
                </p>
              </div>
              {b.open &&
                me?.eligible &&
                (e.owner_is_me ? (
                  <p className="muted">Your own work</p>
                ) : (
                  <div className="stack-form">
                    <label>
                      Why you recommend it (optional; shown without your name after closing)
                      <input
                        maxLength={500}
                        value={notes[e.id] ?? mine?.explanation ?? ''}
                        onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })}
                      />
                    </label>
                    <div className="button-row">
                      <button
                        disabled={work.busy || (!mine && Number(me.available) < 1)}
                        onClick={() => act('cast_vote', e.id)}
                      >
                        {mine ? 'Update recommendation' : 'Recommend'}
                      </button>
                      {mine && (
                        <button
                          className="secondary"
                          disabled={work.busy}
                          onClick={() => act('withdraw_vote', e.id)}
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function VotingBudgetPanel() {
  const { session, revision } = useApp()
  const budget = useLoad(
    async () =>
      session
        ? result<
            VotingBudget & {
              fines_detail: {
                id: string
                amount: number
                reason: string
                imposed_at: string
                revoked_at: string | null
              }[]
            }
          >(db().rpc('my_voting_budget'))
        : null,
    [session?.user.id, revision],
  )
  if (!budget.data) return <Feedback error={budget.error} />
  const d = budget.data
  const n = (x: number) => Number(x).toLocaleString()
  return (
    <section className="panel voting-budget">
      <span className="step">YOUR VOTING BUDGET</span>
      <h2>
        {n(d.available)} of {n(d.earned)} points available
      </h2>
      <p className="muted">
        Eligible creators recommend works on topic ballots. Each recommendation uses one point until
        its ballot closes.
      </p>
      <div className="table-scroll">
        <table className="budget-table">
          <tbody>
            <tr>
              <td>Videos with an approved placement</td>
              <td>
                {d.videos} × {n(d.a)}
              </td>
              <td>{n(d.videos * d.a)}</td>
            </tr>
            <tr>
              <td>TV subtitle versions (one per TV, track and day)</td>
              <td>
                {d.subtitles} × {n(d.b)}
              </td>
              <td>{n(d.subtitles * d.b)}</td>
            </tr>
            <tr>
              <td>Comments on other creators’ videos</td>
              <td>
                {d.comments} × {n(d.c)}
              </td>
              <td>{n(d.comments * d.c)}</td>
            </tr>
            <tr>
              <td>Fines</td>
              <td>
                {n(d.fines)} × {n(d.z)}
              </td>
              <td>−{n(d.fines * d.z)}</td>
            </tr>
            <tr>
              <td>Committed on open ballots</td>
              <td />
              <td>−{n(d.committed)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {d.fines_detail.map((f) => (
        <p key={f.id} className={f.revoked_at ? 'muted small-copy' : 'notice'}>
          Fine of {n(f.amount)} on {dateLabel(f.imposed_at)}: {f.reason}
          {f.revoked_at && ` (revoked ${dateLabel(f.revoked_at)})`}
        </p>
      ))}
    </section>
  )
}

function BallotAdmin() {
  const { locale, revision, refresh } = useApp(),
    work = useWork()
  const topics = useLoad(
    () =>
      result<Topic[]>(
        db().from('topic_labels').select('*').eq('locale', locale).order('name').limit(1000),
      ),
    [locale],
  )
  const ballots = useLoad(
    () => result<BallotSummary[]>(db().rpc('ballot_list', { p_node: null })),
    [revision],
  )
  const [kind, setKind] = useState('video'),
    [topic, setTopic] = useState(''),
    [title, setTitle] = useState(''),
    [days, setDays] = useState('7')
  const [audit, setAudit] = useState<{
    id: string
    rows: {
      entry_id: string
      title: string
      voter: string | null
      voter_id: string
      explanation: string | null
    }[]
  }>()
  const [fineUser, setFineUser] = useState(''),
    [fineAmount, setFineAmount] = useState('1'),
    [fineReason, setFineReason] = useState('')
  return (
    <section className="panel">
      <h2>Creator ballots</h2>
      <p className="muted">
        A ballot fixes its works when it opens. Votes stay sealed, even here, until it closes.
      </p>
      <Feedback {...work} />
      <Feedback error={topics.error || ballots.error} />
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault()
          void work.run(async () => {
            await result(
              db().rpc('open_ballot', {
                p_kind: kind,
                p_node: topic,
                p_title: title,
                p_closes_at: new Date(Date.now() + Number(days) * 86400000).toISOString(),
              }),
            )
            setTitle('')
            work.setMessage('Ballot opened.')
            refresh()
          })
        }}
      >
        <div className="form-row">
          <label>
            Works
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="video">Videos</option>
              <option value="tv">TV editions</option>
            </select>
          </label>
          <label>
            Topic
            <select required value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">Choose a topic</option>
              {topics.data?.map((t) => (
                <option key={t.node_id} value={t.node_id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Closes in (days)
            <input
              type="number"
              min="1"
              max="90"
              required
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
        </div>
        <label>
          Title
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button disabled={work.busy}>Open ballot</button>
      </form>
      <ul className="submission-list">
        {ballots.data?.map((b) => (
          <li key={b.id}>
            <Link to={`/ballot/${b.id}`}>{b.title}</Link>{' '}
            <small>
              {b.topic} · {b.kind === 'video' ? 'videos' : 'TV editions'} ·{' '}
              {plural(b.entries, 'work')} ·{' '}
              {b.open ? `closes ${new Date(b.closes_at).toLocaleString()}` : 'closed'}
            </small>{' '}
            {b.open ? (
              <button
                className="secondary"
                disabled={work.busy}
                onClick={() =>
                  work.run(async () => {
                    try {
                      await result(db().rpc('close_ballot', { p_ballot: b.id }))
                      work.setMessage('Ballot closed; its results are now public.')
                    } finally {
                      refresh()
                    }
                  })
                }
              >
                Close now
              </button>
            ) : (
              <button
                className="plain"
                disabled={work.busy}
                onClick={() =>
                  work.run(async () =>
                    setAudit({
                      id: b.id,
                      rows: await result(db().rpc('ballot_audit', { p_ballot: b.id })),
                    }),
                  )
                }
              >
                Audit votes
              </button>
            )}
          </li>
        ))}
      </ul>
      {audit && (
        <div className="notice">
          <strong>Votes on this ballot</strong>{' '}
          <button className="plain" onClick={() => setAudit(undefined)}>
            Hide
          </button>
          {!audit.rows.length && <p>No votes.</p>}
          <ul className="submission-list">
            {audit.rows.map((r, i) => (
              <li key={i}>
                {r.voter || 'Unknown account'} → {r.title}
                {r.explanation && ` — “${r.explanation}”`} <small>(user id {r.voter_id})</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      <h3>Fines</h3>
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault()
          void work.run(async () => {
            await result(
              db().rpc('impose_fine', {
                p_user: fineUser.trim(),
                p_amount: Number(fineAmount),
                p_reason: fineReason,
              }),
            )
            setFineReason('')
            work.setMessage('Fine recorded. The creator sees its reason with their budget.')
            refresh()
          })
        }}
      >
        <div className="form-row">
          <label>
            Creator user id
            <input
              required
              pattern="[0-9a-fA-F-]{36}"
              value={fineUser}
              onChange={(e) => setFineUser(e.target.value)}
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="0.25"
              step="0.25"
              required
              value={fineAmount}
              onChange={(e) => setFineAmount(e.target.value)}
            />
          </label>
        </div>
        <label>
          Reason shown to the creator
          <textarea
            required
            maxLength={1000}
            value={fineReason}
            onChange={(e) => setFineReason(e.target.value)}
          />
        </label>
        <button disabled={work.busy}>Impose fine</button>
      </form>
    </section>
  )
}

function TVSubtitleEditor({
  clip,
  track,
  cues,
  onSaved,
}: {
  clip: import('./api').Fragment
  track: string
  cues: (Cue & { user_id?: string })[]
  onSaved: () => void
}) {
  const { session, locale, signIn } = useApp()
  const work = useWork()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const source = clip.curated ? 'curated' : 'creator'
  const history = useLoad(
    () =>
      session && historyOpen
        ? result<
            {
              id: number
              cue_id: string
              revision: number
              operation: string
              editor: string | null
              recorded_at: string
              snapshot: Cue
            }[]
          >(
            db().rpc('subtitle_history_list', {
              p_source: source,
              p_context: clip.curated ? clip.id : clip.video_id,
              p_track: track,
              p_locale: locale,
            }),
          )
        : Promise.resolve([]),
    [clip.id, track, locale, session?.user.id, historyOpen, historyRevision],
  )
  function saved() {
    onSaved()
    setHistoryRevision((n) => n + 1)
  }

  const owner = useLoad(
    () =>
      clip.curated
        ? Promise.resolve(true)
        : result<boolean>(db().rpc('owns_video', { p_video: clip.video_id })),
    [clip.id, session?.user.id],
  )
  return (
    <SubtitleEditor
      key={session?.user.id || 'guest'}
      clip={clip}
      track={track}
      locale={locale}
      userId={session?.user.id}
      cues={cues}
      canEdit={Boolean(session && owner.data)}
      onSaved={saved}
      signIn={() => void work.run(signIn)}
      history={
        <>
          <Feedback error={work.error || owner.error || history.error} message={work.message} />
          {session && owner.data && (
            <section className="subtitle-history">
              <button className="plain" onClick={() => setHistoryOpen((v) => !v)}>
                {historyOpen ? 'Hide history' : 'Revision history & restore'}
              </button>
              {historyOpen && (
                <>
                  <p className="muted">
                    Latest 100 changes for this track. Restoring creates a new revision and keeps
                    the history.
                  </p>
                  {!history.data ? (
                    <p>Loading history…</p>
                  ) : !history.data.length ? (
                    <p>No revisions yet.</p>
                  ) : (
                    history.data.map((h) => {
                      const latest = Math.max(
                        ...(history.data || [])
                          .filter((r) => r.cue_id === h.cue_id)
                          .map((r) => r.revision),
                      )
                      return (
                        <article className="cue" key={h.id}>
                          <small>
                            Revision {h.revision} · {h.operation} ·{' '}
                            {new Date(h.recorded_at).toLocaleString()} ·{' '}
                            {h.editor
                              ? h.editor === session.user.id
                                ? 'You'
                                : `Contributor ${h.editor.slice(0, 8)}`
                              : 'Initial content'}
                          </small>
                          <p>
                            {timeLabel(h.snapshot.start_seconds)}–
                            {timeLabel(h.snapshot.end_seconds)}
                          </p>
                          <Markdown text={h.snapshot.markdown} />
                          {(h.revision < latest || h.operation === 'delete') && (
                            <button
                              className="plain"
                              disabled={work.busy}
                              onClick={() =>
                                work.run(async () => {
                                  await result(
                                    db().rpc('restore_subtitle', {
                                      p_history: h.id,
                                      p_expected: latest,
                                    }),
                                  )
                                  work.setMessage('Subtitle restored as a new revision.')
                                  saved()
                                })
                              }
                            >
                              {h.operation === 'delete'
                                ? 'Restore removed subtitle'
                                : 'Restore this revision'}
                            </button>
                          )}
                        </article>
                      )
                    })
                  )}
                </>
              )}
            </section>
          )}
        </>
      }
    />
  )
}

function Watch() {
  const { video = '' } = useParams(),
    [params, setParams] = useSearchParams(),
    node = params.get('topic') || null
  const { locale, revision, session, refresh, signIn } = useApp(),
    work = useWork()
  const [body, setBody] = useState('')
  const { data, error } = useLoad(
    () =>
      result<VideoDetail>(
        db().rpc('video_detail', { p_video: video, p_node: node, p_locale: locale }),
      ),
    [video, node, locale, revision],
  )
  const context = useLoad(
    () => (node ? browse(node, locale) : Promise.resolve(null)),
    [node, locale, revision],
  )
  if (!data) return <Loading error={error} />
  if (!data.video)
    return (
      <Empty title="This video isn’t available.">
        <Link to="/">Back to the community →</Link>
      </Empty>
    )
  return (
    <div className="page watch-page">
      {context.data && <Breadcrumbs topics={context.data.breadcrumbs} />}
      <Feedback error={context.error} />
      <Player video={video} cues={data.cues} />
      <div className="section-heading">
        <div>
          <h1 className="video-title">{data.video.title}</h1>
          <p>{data.video.channel_title}</p>
        </div>
        <a
          className="text-link"
          href={`https://www.youtube.com/watch?v=${video}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          On YouTube ↗
        </a>
      </div>
      <div className="chips">
        {data.topics.map((t) => (
          <Link key={t.node_id} to={topicUrl(t.node_id)}>
            {t.name} ↗
          </Link>
        ))}
      </div>
      <section className="conversation">
        <div className="eyebrow">A CONVERSATION BETWEEN CREATORS</div>
        <h2>
          {context.data?.node ? `Around ${context.data.node.name}` : 'Find your shared ground'}
        </h2>
        {!node && (
          <>
            <p>
              Choose a topic to join its conversation. A verified video in that topic or a
              descendant gives you commenting access.
            </p>
            <div className="chips">
              {data.topics.map((t) => (
                <button key={t.node_id} onClick={() => setParams({ topic: t.node_id })}>
                  {t.name}
                </button>
              ))}
            </div>
          </>
        )}
        {node && (
          <>
            {!session ? (
              <button onClick={() => work.run(signIn)}>Sign in to join the conversation</button>
            ) : data.can_comment ? (
              <form
                className="stack-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void work.run(async () => {
                    await result(
                      db()
                        .from('comments')
                        .insert({ video_id: video, node_id: node, user_id: session.user.id, body }),
                    )
                    setBody('')
                    refresh()
                  })
                }}
              >
                <label>
                  Your perspective
                  <textarea
                    required
                    maxLength={4000}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Build on an idea, ask a thoughtful question…"
                  />
                </label>
                <button disabled={work.busy}>
                  {work.busy ? 'Posting…' : 'Add your comment ↗'}
                </button>
              </form>
            ) : (
              <div className="notice">
                To comment here, add a verified video to this topic or one of its descendants and
                have its topic placement approved. Verification lasts 30 days.{' '}
                <Link to="/studio">Open creator studio →</Link>
              </div>
            )}
            <Feedback {...work} />
            {data.comments.length ? (
              data.comments.map((c) => (
                <article className="comment" key={c.id}>
                  <div className="comment-head">
                    <strong>{c.author}</strong>
                    <time>{new Date(c.created_at).toLocaleDateString(locale)}</time>
                    {c.user_id === session?.user.id && (
                      <button
                        className="plain"
                        disabled={work.busy}
                        onClick={() =>
                          work.run(async () => {
                            await result(db().from('comments').delete().eq('id', c.id))
                            refresh()
                          })
                        }
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <Markdown text={c.body} />
                </article>
              ))
            ) : (
              <p className="muted">The conversation is open. Bring a new perspective.</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Studio() {
  const { session, locale, revision, refresh, signIn } = useApp(),
    work = useWork(),
    navigate = useNavigate()
  const [params] = useSearchParams()
  const [url, setUrl] = useState(''),
    [topic, setTopic] = useState(params.get('topic') || ''),
    [selected, setSelected] = useState('')
  const [clipTitle, setClipTitle] = useState(''),
    [start, setStart] = useState('0'),
    [end, setEnd] = useState('30')
  const [subtitleTrack, setSubtitleTrack] = useState('version1')
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const [subtitleRevision, setSubtitleRevision] = useState(0)
  const topics = useLoad(
    () =>
      result<Topic[]>(
        db().from('topic_labels').select('*').eq('locale', locale).order('name').limit(1000),
      ),
    [locale, revision],
  )
  const mine = useLoad(async () => {
    if (!session) return []
    const channels = await result<{ channel_id: string }[]>(
      db().from('channels').select('channel_id').eq('user_id', session.user.id),
    )
    if (!channels.length) return []
    return result<(Video & { video_topics: { node_id: string; status: string }[] })[]>(
      db()
        .from('videos')
        .select('*,video_topics(node_id,status)')
        .in(
          'channel_id',
          channels.map((c) => c.channel_id),
        )
        .order('created_at', { ascending: false }),
    )
  }, [session?.user.id, revision])
  const submissions = useLoad(
    async () => (session ? result<Submissions>(db().rpc('my_submissions')) : null),
    [session?.user.id, revision],
  )
  const cues = useLoad(
    () =>
      selected
        ? result<Cue[]>(
            db()
              .from('subtitle_cues')
              .select('*')
              .eq('video_id', selected)
              .eq('locale', locale)
              .order('start_seconds'),
          )
        : Promise.resolve([]),
    [selected, locale, revision, subtitleRevision],
  )
  const chosen = mine.data?.find((v) => v.video_id === selected)
  const approved = chosen?.video_topics.filter((t) => t.status === 'approved') || []
  if (!session)
    return (
      <div className="page">
        <Empty title="Your ideas belong here.">
          <p>Connect your Google account to verify your YouTube videos and join the community.</p>
          <button disabled={work.busy} onClick={() => work.run(signIn)}>
            Connect with Google ↗
          </button>
          <Feedback {...work} />
        </Empty>
      </div>
    )
  return (
    <div className="page">
      <div className="eyebrow">YOUR CORNER OF THE COMMUNITY</div>
      <h1>Creator studio.</h1>
      <p className="muted">Share your work, find its place, and bring a moment to Agape TV.</p>
      <Feedback {...work} />
      <Feedback error={topics.error || mine.error || cues.error || submissions.error} />
      <div className="studio-grid">
        <section className="panel">
          <span className="step">01 / CONNECT AN IDEA</span>
          <h2>Add your YouTube video</h2>
          <p className="muted">
            We verify channel ownership with YouTube. Topic placement is reviewed before it appears
            in the community.
          </p>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault()
              void work.run(async () => {
                const id = videoId(url)
                if (!id)
                  throw new Error('Enter a valid YouTube video link or 11-character video ID.')
                const token = (await db().auth.getSession()).data.session?.provider_token
                if (!token)
                  throw new Error(
                    'Reconnect with Google to authorize YouTube verification for this session.',
                  )
                const { data, error } = await db().functions.invoke('agape-verify-video', {
                  body: { video_id: id, node_id: topic, provider_token: token },
                })
                if (error) {
                  let message =
                    'Video verification failed. Check that the verification function is deployed and reconnect your Google account if needed.'
                  try {
                    const body = await error.context?.json()
                    if (body?.error) message = body.error
                  } catch {
                    /* Use the actionable fallback. */
                  }
                  throw new Error(message)
                }
                if (data?.error) throw new Error(data.error)
                setUrl('')
                setSelected(id)
                work.setMessage('Ownership verified. Your topic placement is awaiting review.')
                refresh()
              })
            }}
          >
            <label>
              YouTube URL
              <input
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
              />
            </label>
            <label>
              Place it in a topic
              <select required value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">Choose an Agape topic</option>
                {topics.data?.map((t) => (
                  <option key={t.node_id} value={t.node_id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={work.busy || !topics.data?.length}>
              {work.busy ? 'Verifying…' : 'Verify & submit video ↗'}
            </button>
          </form>
          <button className="plain" onClick={() => work.run(signIn)}>
            Reconnect Google / YouTube access
          </button>
          {!topics.data?.length && <p className="notice">A topic needs to be created first.</p>}
        </section>
        <section className="panel">
          <span className="step">02 / YOUR CONTRIBUTIONS</span>
          <h2>Your videos</h2>
          {!mine.data ? (
            <p>Loading your videos…</p>
          ) : !mine.data.length ? (
            <p className="muted">Your verified videos will appear here.</p>
          ) : (
            <div className="owned-list">
              {mine.data.map((v) => (
                <button
                  className={selected === v.video_id ? 'owned selected' : 'owned'}
                  key={v.video_id}
                  onClick={() => setSelected(v.video_id)}
                >
                  <strong>{v.title}</strong>
                  {submissions.data?.placements
                    .filter((p) => p.video_id === v.video_id)
                    .map((p) => (
                      <span className="placement" key={p.node_id}>
                        {p.topic} ·{' '}
                        <SubmissionStatus
                          status={p.status}
                          submitted={p.submitted_at}
                          decided={p.decided_at}
                          reason={p.reason}
                        />
                      </span>
                    ))}
                </button>
              ))}
            </div>
          )}
          <p className="muted small-copy">
            Select a video to add a fragment or edit its creator subtitles.
          </p>
          {submissions.data?.placements.some((p) => p.status === 'rejected') && (
            <p className="notice">
              A placement that was not approved can be resubmitted above, in the same topic or a
              better-suited one. It returns to the review queue.
            </p>
          )}
          {!!submissions.data?.topics.length && (
            <>
              <h3>Your topic suggestions</h3>
              <ul className="submission-list">
                {submissions.data.topics.map((t) => (
                  <li key={t.id}>
                    {t.created_node_id ? (
                      <Link to={topicUrl(t.created_node_id)}>{t.name}</Link>
                    ) : (
                      <strong>{t.name}</strong>
                    )}
                    {t.parent && <small> in {t.parent}</small>} ·{' '}
                    <SubmissionStatus
                      status={t.status}
                      submitted={t.created_at}
                      decided={t.decided_at}
                      reason={t.reason}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
          <TopicForm parent={null} />
        </section>
      </div>
      <VotingBudgetPanel />
      {chosen && (
        <>
          <div className="section-heading">
            <h2>{chosen.title}</h2>
            <button className="plain" onClick={() => navigate(watchUrl(selected))}>
              Preview video ↗
            </button>
          </div>
          <div className="studio-grid">
            <section className="panel">
              <span className="step">03 / A MOMENT WORTH SHARING</span>
              <h2>Add to Agape TV</h2>
              <form
                className="stack-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void work.run(async () => {
                    const form = new FormData(e.currentTarget)
                    await result(
                      db().rpc('submit_fragment', {
                        p_video: selected,
                        p_node: form.get('clipTopic'),
                        p_title: clipTitle,
                        p_start: Number(start),
                        p_end: Number(end),
                      }),
                    )
                    setClipTitle('')
                    work.setMessage('Your fragment is now in the topic’s TV loop.')
                    refresh()
                  })
                }}
              >
                <label>
                  Moment title
                  <input
                    required
                    maxLength={160}
                    value={clipTitle}
                    onChange={(e) => setClipTitle(e.target.value)}
                  />
                </label>
                <label>
                  Approved topic
                  <select name="clipTopic" required>
                    <option value="">Choose a topic</option>
                    {approved.map((t) => (
                      <option key={t.node_id} value={t.node_id}>
                        {topics.data?.find((n) => n.node_id === t.node_id)?.name || t.node_id}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="form-row">
                  <label>
                    Start (seconds)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      max={chosen.duration_seconds}
                      required
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </label>
                  <label>
                    End (seconds)
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      max={chosen.duration_seconds}
                      required
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                </div>
                <button disabled={work.busy || !approved.length}>Publish fragment ↗</button>
              </form>
              {!approved.length && (
                <p className="notice">Your video needs an approved topic placement first.</p>
              )}
              {!!approved.length && (
                <p className="muted small-copy">
                  Approved placements also let you comment within these topics and create a named TV
                  there:{' '}
                  {approved.map((t, i) => (
                    <span key={t.node_id}>
                      {i > 0 && ', '}
                      <Link to={`/tv/${t.node_id}`}>
                        {topics.data?.find((n) => n.node_id === t.node_id)?.name || 'Topic'} TV
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </section>
            <section className="panel">
              <span className="step">04 / ADD SOME CONTEXT</span>
              <h2>Creator subtitles</h2>
              <p className="muted">
                Edit complete subtitle tracks with a video preview, timeline, import/export, and
                revision history.
              </p>
              <select
                aria-label="Creator subtitle version"
                value={subtitleTrack}
                onChange={(e) => setSubtitleTrack(e.target.value)}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={`version${n}`}>
                    Version {n} · {locale === 'fr' ? 'French' : 'English'}
                  </option>
                ))}
              </select>
              <button onClick={() => setSubtitleOpen(true)}>Open subtitle studio</button>
              {subtitleOpen && (
                <div
                  className="tv-editor-overlay"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Edit creator subtitles"
                >
                  <button
                    autoFocus
                    className="tv-editor-close"
                    onClick={() => setSubtitleOpen(false)}
                  >
                    Close subtitles ×
                  </button>
                  <TVSubtitleEditor
                    key={`${selected}-${locale}-${subtitleTrack}`}
                    track={subtitleTrack}
                    clip={{
                      id: selected,
                      video_id: selected,
                      title: chosen.title,
                      video_title: chosen.title,
                      channel_title: chosen.channel_title,
                      start_seconds: 0,
                      end_seconds: chosen.duration_seconds,
                    }}
                    cues={cues.data?.filter((c) => c.track === subtitleTrack) || []}
                    onSaved={() => setSubtitleRevision((n) => n + 1)}
                  />
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

type Submissions = {
  placements: {
    video_id: string
    title: string
    node_id: string
    topic: string
    status: string
    submitted_at: string
    decided_at: string | null
    reason: string | null
  }[]
  topics: {
    id: string
    name: string
    parent: string | null
    status: string
    created_at: string
    created_node_id: string | null
    decided_at: string | null
    reason: string | null
  }[]
}
type ReviewQueue = {
  videos: {
    video_id: string
    node_id: string
    title: string
    duration_seconds: number
    channel_title: string
    submitted_at: string
    topic: string
    approved_placements: number
    history: { decision: string; reason: string | null; decided_at: string }[]
  }[]
  topics: {
    id: string
    name: string
    description: string
    parent_id: string | null
    parent: string | null
    proposer: string
    created_at: string
  }[]
  recent: {
    kind: string
    decision: string
    reason: string | null
    decided_at: string
    subject: string | null
    topic: string | null
    decided_by: string | null
  }[]
}
function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : ''
}
function SubmissionStatus({
  status,
  submitted,
  decided,
  reason,
}: {
  status: string
  submitted: string
  decided: string | null
  reason: string | null
}) {
  if (status === 'pending')
    return <small>Waiting for review · submitted {dateLabel(submitted)}</small>
  if (status === 'approved') return <small>Approved {dateLabel(decided)}</small>
  return (
    <small className="rejected">
      Not approved {dateLabel(decided)}
      {reason && `: ${reason}`}
    </small>
  )
}
function ReviewLink() {
  const { revision } = useApp()
  const queue = useLoad(() => result<ReviewQueue>(db().rpc('moderation_queue')), [revision])
  const pending = (queue.data?.videos.length || 0) + (queue.data?.topics.length || 0)
  return <NavLink to="/admin">Review{pending ? ` · ${pending}` : ''}</NavLink>
}
function ReviewActions({
  busy,
  onDecide,
}: {
  busy: boolean
  onDecide: (approve: boolean, reason: string) => void
}) {
  const [rejecting, setRejecting] = useState(false),
    [note, setNote] = useState('')
  return rejecting ? (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault()
        onDecide(false, note)
      }}
    >
      <label>
        Reason shown to the submitter
        <textarea
          required
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button disabled={busy || !note.trim()}>Reject with reason</button>
        <button type="button" className="secondary" onClick={() => setRejecting(false)}>
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <div className="stack-form">
      <label>
        Note to the submitter (optional)
        <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="button-row">
        <button disabled={busy} onClick={() => onDecide(true, note)}>
          Approve
        </button>
        <button className="secondary" disabled={busy} onClick={() => setRejecting(true)}>
          Reject…
        </button>
      </div>
    </div>
  )
}

function Admin() {
  const { admin, revision, refresh } = useApp(),
    work = useWork()
  const { data, error } = useLoad(
    () => (admin ? result<ReviewQueue>(db().rpc('moderation_queue')) : Promise.resolve(null)),
    [admin, revision],
  )
  if (!admin)
    return (
      <Empty title="Community review">
        <p>This page is available to Agape administrators.</p>
      </Empty>
    )
  function decide(kind: string, id: string, node: string | null, approve: boolean, reason: string) {
    void work.run(async () => {
      try {
        await result(
          db().rpc('moderate', {
            p_kind: kind,
            p_id: id,
            p_node: node,
            p_approve: approve,
            p_reason: reason.trim() || null,
          }),
        )
        work.setMessage(approve ? 'Approved.' : 'Rejected. The submitter can now see your reason.')
      } finally {
        // Refresh on failure too, so an item another administrator already reviewed disappears.
        refresh()
      }
    })
  }
  return (
    <div className="page">
      <div className="eyebrow">CARE FOR THE COMMUNITY</div>
      <h1>Review contributions.</h1>
      <p className="muted">
        Approve a video’s placement only when its content belongs to the proposed topic. Approved
        placements grant subtree commenting rights and let creators start named TVs there.
        Submitters see your decision, date, and reason, but not who reviewed it.
      </p>
      <Feedback {...work} />
      <TopicForm parent={null} />
      <BallotAdmin />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <h2>Video placements · {data.videos.length} waiting</h2>
          {!data.videos.length && <p className="muted">No videos waiting.</p>}
          {data.videos.map((v) => (
            <article className="review-item" key={`${v.video_id}-${v.node_id}`}>
              <div>
                <a
                  href={`https://www.youtube.com/watch?v=${v.video_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    className="review-thumbnail"
                    src={`https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                  />
                </a>
                <h3>
                  <a
                    href={`https://www.youtube.com/watch?v=${v.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {v.title} ↗
                  </a>
                </h3>
                <p className="muted">
                  {v.channel_title} · {timeLabel(v.duration_seconds)} · submitted{' '}
                  {dateLabel(v.submitted_at)}
                </p>
                <p>
                  Proposed topic: <Link to={topicUrl(v.node_id)}>{v.topic}</Link>
                </p>
                <p className="muted small-copy">
                  {v.approved_placements
                    ? `${v.approved_placements} approved placement${v.approved_placements === 1 ? '' : 's'} from this creator`
                    : 'No approved placements from this creator yet'}
                </p>
                {v.history.map((h, i) => (
                  <p className="muted small-copy" key={i}>
                    Earlier: {h.decision === 'approved' ? 'approved' : 'not approved'}{' '}
                    {dateLabel(h.decided_at)}
                    {h.reason && ` — ${h.reason}`}
                  </p>
                ))}
              </div>
              <ReviewActions
                busy={work.busy}
                onDecide={(approve, reason) =>
                  decide('video', v.video_id, v.node_id, approve, reason)
                }
              />
            </article>
          ))}
          <h2>Topic suggestions · {data.topics.length} waiting</h2>
          {!data.topics.length && <p className="muted">No suggestions waiting.</p>}
          {data.topics.map((t) => (
            <article className="review-item" key={t.id}>
              <div>
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <p className="muted">
                  {t.parent ? (
                    <>
                      Under <Link to={topicUrl(t.parent_id)}>{t.parent}</Link>
                    </>
                  ) : (
                    'New root topic'
                  )}{' '}
                  · suggested by {t.proposer} · {dateLabel(t.created_at)}
                </p>
              </div>
              <ReviewActions
                busy={work.busy}
                onDecide={(approve, reason) => decide('topic', t.id, null, approve, reason)}
              />
            </article>
          ))}
          <h2>Recent decisions</h2>
          {!data.recent.length && <p className="muted">No decisions yet.</p>}
          <ul className="submission-list">
            {data.recent.map((d, i) => (
              <li key={i}>
                <strong>{d.decision === 'approved' ? 'Approved' : 'Rejected'}</strong>{' '}
                {d.kind === 'video' ? 'video' : 'topic'} “{d.subject}”{d.topic && ` in ${d.topic}`}{' '}
                · {new Date(d.decided_at).toLocaleString()}
                {d.decided_by && ` · ${d.decided_by}`}
                {d.reason && ` — ${d.reason}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
