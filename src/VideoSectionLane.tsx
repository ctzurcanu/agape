import { useRef, useState } from 'react'
import type { Fragment } from './api'
import { programTimeline } from './utils'
export function VideoSectionLane({
  sections,
  disabled,
  onMove,
  onTrim,
  onSelect,
}: {
  sections: Fragment[]
  disabled: boolean
  onMove: (from: number, to: number) => void
  onTrim: (section: Fragment, start: number, end: number) => void
  onSelect: (time: number) => void
}) {
  const timeline = programTimeline(sections)
  const drag = useRef<{
    index: number
    edge: string
    x: number
    width: number
    delta: number
    target: number
  } | null>(null)
  const [preview, setPreview] = useState<{
    index: number
    edge: string
    delta: number
    target: number
  }>()
  return (
    <div
      className="video-section-lane"
      aria-label="Video fragments timeline"
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.delta = Math.round(((e.clientX - d.x) / d.width) * timeline.total)
        const offset = timeline.segments[d.index].offset + d.delta
        d.target = timeline.segments.findIndex((s) => offset < s.offset + s.duration)
        if (d.target < 0) d.target = sections.length - 1
        setPreview({ ...d })
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        setPreview(undefined)
        if (!d) return
        const f = sections[d.index]
        if (d.edge === 'move') {
          if (d.target !== d.index) onMove(d.index, d.target)
          else onSelect(timeline.segments[d.index].offset)
        } else if (d.delta !== 0) {
          onTrim(
            f,
            d.edge === 'start'
              ? Math.max(0, Math.min(f.end_seconds - 1, f.start_seconds + d.delta))
              : f.start_seconds,
            d.edge === 'end'
              ? Math.max(f.start_seconds + 1, f.end_seconds + d.delta)
              : f.end_seconds,
          )
        }
      }}
      onPointerCancel={() => {
        drag.current = null
        setPreview(undefined)
      }}
    >
      {timeline.segments.map((s, i) => {
        const f = sections[i],
          p = preview?.index === i ? preview : undefined
        let left = s.offset,
          width = s.duration
        if (p?.edge === 'move') left += p.delta
        else if (p?.edge === 'start') {
          left += p.delta
          width -= p.delta
        } else if (p?.edge === 'end') width += p.delta
        return (
          <div
            key={f.id}
            className={`se-block video-section-block ${preview?.target === i ? 'drop-target' : ''}`}
            style={{
              left: `${(left / timeline.total) * 100}%`,
              width: `${(Math.max(1, width) / timeline.total) * 100}%`,
              zIndex: p ? 4 : 2,
            }}
            title={`${i + 1}. ${f.title} · source ${f.start_seconds}–${f.end_seconds}s${p ? ` · ${p.delta > 0 ? '+' : ''}${p.delta}s` : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              if (disabled) return
              e.currentTarget.parentElement!.setPointerCapture(e.pointerId)
              drag.current = {
                index: i,
                edge: (e.target as HTMLElement).dataset.edge || 'move',
                x: e.clientX,
                width: e.currentTarget.parentElement!.getBoundingClientRect().width,
                delta: 0,
                target: i,
              }
            }}
          >
            <button
              data-edge="start"
              disabled={disabled}
              aria-label={`Trim video ${i + 1} start`}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  onTrim(
                    f,
                    Math.max(
                      0,
                      Math.min(
                        f.end_seconds - 1,
                        f.start_seconds + (e.key === 'ArrowLeft' ? -1 : 1),
                      ),
                    ),
                    f.end_seconds,
                  )
                }
              }}
            />
            <button
              className="se-block-text"
              aria-label={`Video ${i + 1}: ${f.title}. Alt arrows reorder.`}
              onClick={() => {
                if (!drag.current) onSelect(s.offset)
              }}
              onKeyDown={(e) => {
                if (e.altKey && !disabled && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                  e.preventDefault()
                  onMove(
                    i,
                    Math.max(
                      0,
                      Math.min(sections.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)),
                    ),
                  )
                }
              }}
            >
              {i + 1}. {f.title}
            </button>
            <button
              data-edge="end"
              disabled={disabled}
              aria-label={`Trim video ${i + 1} end`}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault()
                  onTrim(
                    f,
                    f.start_seconds,
                    Math.max(f.start_seconds + 1, f.end_seconds + (e.key === 'ArrowLeft' ? -1 : 1)),
                  )
                }
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
