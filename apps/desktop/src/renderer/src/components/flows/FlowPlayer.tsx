import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { vi } from '../../strings'

export interface Props {
  count: number
  index: number
  onChange: (index: number) => void
}

export const SPEEDS = [
  { label: '0,5×', ms: 3000 },
  { label: '1×', ms: 1500 },
  { label: '2×', ms: 750 }
]

export function FlowPlayer({ count, index, onChange }: Props) {
  const [playing, setPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(1500)
  const indexRef = useRef(index)
  indexRef.current = index

  // Khi tới bước cuối thì tự dừng
  useEffect(() => {
    if (index >= count - 1) {
      setPlaying(false)
    }
  }, [index, count])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const next = indexRef.current + 1
      if (next < count) {
        onChange(next)
      } else {
        setPlaying(false)
      }
    }, speedMs)
    return () => clearInterval(timer)
  }, [playing, speedMs, count, onChange])

  const togglePlay = () => {
    if (!playing && index >= count - 1) {
      onChange(0)
    }
    setPlaying(!playing)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (index < count - 1) onChange(index + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (index > 0) onChange(index - 1)
    } else if (e.key === ' ') {
      e.preventDefault()
      togglePlay()
    }
  }

  const stepLabel = vi.flows.step(index + 1, count)

  return (
    <div
      className="player-bar"
      role="group"
      aria-label={stepLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="player-controls">
        <button
          type="button"
          className="btn-icon"
          disabled={index <= 0}
          onClick={() => onChange(0)}
          aria-label={vi.flows.first}
        >
          {vi.flows.first}
        </button>
        <button
          type="button"
          className="btn-icon"
          disabled={index <= 0}
          onClick={() => onChange(Math.max(0, index - 1))}
          aria-label={vi.flows.prev}
        >
          {vi.flows.prev}
        </button>
        <button
          type="button"
          className={`btn-icon play ${playing ? 'active' : ''}`}
          onClick={togglePlay}
          aria-label={playing ? vi.flows.pause : vi.flows.play}
        >
          {playing ? vi.flows.pause : vi.flows.play}
        </button>
        <button
          type="button"
          className="btn-icon"
          disabled={index >= count - 1}
          onClick={() => onChange(Math.min(count - 1, index + 1))}
          aria-label={vi.flows.next}
        >
          {vi.flows.next}
        </button>
        <button
          type="button"
          className="btn-icon"
          disabled={index >= count - 1}
          onClick={() => onChange(count - 1)}
          aria-label={vi.flows.last}
        >
          {vi.flows.last}
        </button>
      </div>

      <div className="step-counter">{stepLabel}</div>

      <div className="player-speed">
        <span className="muted small">{vi.flows.speed}</span>
        <div className="segmented">
          {SPEEDS.map((s) => (
            <label key={s.label}>
              <input
                type="radio"
                name="flow-speed"
                value={s.ms}
                checked={speedMs === s.ms}
                onChange={() => setSpeedMs(s.ms)}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
