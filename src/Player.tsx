import { useEffect, useRef, useState } from 'react'
import type { Cue } from './api'
import { activeCues } from './utils'
import { Markdown } from './Markdown'

export function setYouTubeCaptions(player: YT.Player, enabled: boolean) {
  const modules = player as YT.Player & {
    loadModule?: (name: string) => void
    unloadModule?: (name: string) => void
  }
  if (enabled) modules.loadModule?.('captions')
  else {
    modules.unloadModule?.('captions')
    modules.unloadModule?.('cc')
  }
}

let apiPromise: Promise<void> | undefined
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve()
  if (!apiPromise)
    apiPromise = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        apiPromise = undefined
        reject(new Error('YouTube did not load. Check your connection or content blocker.'))
      }, 15000)
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer)
        resolve()
      }
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.onerror = () => {
        clearTimeout(timer)
        apiPromise = undefined
        reject(new Error('Unable to reach YouTube.'))
      }
      document.head.appendChild(script)
    })
  return apiPromise
}

export function Player({
  video,
  start = 0,
  end,
  auto = false,
  cues = [],
  onEnd,
  seek,
  onTime,
  captionMode = 'youtube',
  overlayCaptions = false,
  paused = false,
}: {
  video: string
  start?: number
  end?: number
  auto?: boolean
  cues?: Cue[]
  seek?: { time: number; request: number }
  captionMode?: 'youtube' | 'custom' | 'off'
  overlayCaptions?: boolean
  paused?: boolean
  onTime?: (time: number) => void
  onEnd?: () => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const mode = useRef(captionMode)
  mode.current = captionMode
  const control = useRef<YT.Player | undefined>(undefined)
  useEffect(() => {
    if (control.current) setYouTubeCaptions(control.current, captionMode === 'youtube')
  }, [captionMode])
  const pauseRequested = useRef(paused)
  pauseRequested.current = paused
  const resumeAfterEdit = useRef(false)
  useEffect(() => {
    const player = control.current
    if (!player) return
    if (paused) {
      resumeAfterEdit.current = player.getPlayerState() === YT.PlayerState.PLAYING
      player.pauseVideo()
    } else if (resumeAfterEdit.current) {
      resumeAfterEdit.current = false
      player.playVideo()
    }
  }, [paused])
  const latestSeek = useRef(seek)
  latestSeek.current = seek
  const progress = useRef(onTime)
  progress.current = onTime
  useEffect(() => {
    if (seek && control.current) {
      control.current.seekTo(seek.time, true)
      setTime(seek.time)
    }
  }, [seek])
  const host = useRef<HTMLDivElement>(null)
  const done = useRef(onEnd)
  done.current = onEnd
  const [time, setTime] = useState(0)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    let destroyed = false,
      player: YT.Player | undefined,
      timer: number | undefined,
      finished = false
    setError('')
    setTime(start)
    setBlocked(false)
    const suppressCaptions = (target: YT.Player) => {
      if (mode.current !== 'youtube') setYouTubeCaptions(target, false)
    }
    const finish = () => {
      if (!finished && !pauseRequested.current) {
        finished = true
        player?.pauseVideo()
        done.current?.()
      }
    }
    loadYouTube()
      .then(() => {
        if (destroyed || !host.current) return
        const target = document.createElement('div')
        host.current.replaceChildren(target)
        player = new YT.Player(target, {
          videoId: video,
          playerVars: {
            origin: location.origin,
            playsinline: 1,
            cc_load_policy: mode.current === 'youtube' ? 1 : 0,
            ...(overlayCaptions ? { fs: 0 } : {}),
            start: Math.floor(Number(start)),
            ...(end ? { end: Math.ceil(Number(end)) } : {}),
          },
          events: {
            onReady: (e) => {
              if (destroyed) return
              setYouTubeCaptions(e.target, mode.current === 'youtube')
              control.current = e.target
              e.target.getIframe().title = 'YouTube video player'
              if (auto && !pauseRequested.current)
                e.target.loadVideoById({
                  videoId: video,
                  startSeconds: latestSeek.current?.time ?? Number(start),
                  ...(end ? { endSeconds: Number(end) } : {}),
                })
              else
                e.target.cueVideoById({
                  videoId: video,
                  startSeconds: latestSeek.current?.time ?? Number(start),
                  ...(end ? { endSeconds: Number(end) } : {}),
                })
              timer = window.setInterval(() => {
                const t = e.target.getCurrentTime()
                setTime(t)
                progress.current?.(t)
                if (end && t >= Number(end) && e.target.getPlayerState() === YT.PlayerState.PLAYING)
                  finish()
              }, 150)
            },
            onApiChange: (e) => suppressCaptions(e.target),
            onStateChange: (e) => {
              suppressCaptions(e.target)
              if (pauseRequested.current && e.data === YT.PlayerState.PLAYING) {
                e.target.pauseVideo()
                return
              }
              if (e.data === YT.PlayerState.ENDED) finish()
            },
            onError: (e) =>
              setError(
                `This video cannot be played here (YouTube ${e.data}). You can open it on YouTube or skip it.`,
              ),
            onAutoplayBlocked: () => setBlocked(true),
          },
        })
      })
      .catch((e) => {
        if (!destroyed) setError(e.message)
      })
    return () => {
      control.current = undefined
      destroyed = true
      if (timer) clearInterval(timer)
      player?.destroy()
    }
  }, [video, start, end, auto, overlayCaptions])
  const visible = activeCues(cues, time)
  return (
    <div className="player-shell">
      <div className={`video-frame ${overlayCaptions ? 'with-overlay' : ''}`} ref={frame}>
        <div className="player" ref={host} />
        {overlayCaptions && captionMode === 'custom' && visible.length > 0 && (
          <div className="video-subtitles" aria-label="Alternative subtitles">
            {visible.map((c) => (
              <div key={c.id}>
                <Markdown text={c.markdown} />
              </div>
            ))}
          </div>
        )}
        {overlayCaptions && (
          <button
            className="agape-fullscreen"
            aria-label="Toggle video fullscreen"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen()
              else void frame.current?.requestFullscreen()
            }}
          >
            ⛶
          </button>
        )}
      </div>
      {blocked && <p className="notice">Press play in the YouTube player to continue.</p>}
      {error && (
        <p role="alert" className="notice">
          {error}{' '}
          <a
            href={`https://www.youtube.com/watch?v=${video}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open video ↗
          </a>
        </p>
      )}
      {!overlayCaptions && cues.length > 0 && (
        <div className="captions" aria-label="Alternative subtitles">
          {visible.length ? (
            visible.map((c) => <Markdown key={c.id} text={c.markdown} />)
          ) : (
            <span className="muted">Subtitles appear here during playback.</span>
          )}
        </div>
      )}
    </div>
  )
}
