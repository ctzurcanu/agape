import { useState } from 'react'

/** Decode only a creator-selected local file. No media leaves the device. */
export function SubtitleWaveform({
  start,
  end,
  onSeek,
}: {
  start: number
  end: number
  onSeek: (time: number) => void
}) {
  const [audio, setAudio] = useState<{ peaks: number[]; duration: number; name: string }>()
  const [relative, setRelative] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function load(file: File) {
    setBusy(true)
    setError('')
    const context = new AudioContext()
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('Choose an audio file under 100 MB.')
      const decoded = await context.decodeAudioData(await file.arrayBuffer()),
        data = decoded.getChannelData(0)
      const count = 2000,
        peaks = Array.from({ length: count }, (_, i) => {
          const a = Math.floor((i * data.length) / count),
            b = Math.floor(((i + 1) * data.length) / count)
          let peak = 0
          for (let j = a; j < b; j++) peak = Math.max(peak, Math.abs(data[j]))
          return peak
        })
      setAudio({ peaks, duration: decoded.duration, name: file.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to decode this audio file.')
    } finally {
      await context.close()
      setBusy(false)
    }
  }
  return (
    <details className="se-waveform">
      <summary>Audio waveform (local reference file)</summary>
      <div className="se-toolbar">
        <label>
          Choose source audio
          <input
            type="file"
            accept="audio/*"
            aria-label="Reference audio file"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void load(file)
              e.target.value = ''
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={relative}
            onChange={(e) => setRelative(e.target.checked)}
          />{' '}
          Audio starts at excerpt zero
        </label>
        <small>{busy ? 'Decoding…' : audio?.name} · Processed on this device only.</small>
      </div>
      {error && <p role="alert">{error}</p>}
      {audio && (
        <svg
          viewBox="0 0 1000 60"
          preserveAspectRatio="none"
          role="img"
          aria-label="Audio waveform; click to seek, or use the subtitle playhead slider"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            onSeek(start + ((e.clientX - rect.left) / rect.width) * (end - start))
          }}
        >
          {Array.from({ length: 1000 }, (_, i) => {
            const t = start + ((end - start) * i) / 1000 - (relative ? start : 0)
            const peak = audio.peaks[Math.floor((t / audio.duration) * audio.peaks.length)] || 0
            return (
              <line
                key={i}
                x1={i}
                x2={i}
                y1={30 - peak * 29}
                y2={30 + peak * 29}
                stroke="currentColor"
              />
            )
          })}
        </svg>
      )}
    </details>
  )
}
