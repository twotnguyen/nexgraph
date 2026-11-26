import { useRef, type CSSProperties, type ReactNode } from 'react'
import { tr } from '../../i18n/strings'
import { Icon } from './icons'
import './pane-stack.css'

export type PaneSection<Id extends string = string> = { id: Id; title: string; actions?: ReactNode; children: ReactNode }
export type PaneStackState<Id extends string = string> = { collapsed: Partial<Record<Id, boolean>>; heights: Partial<Record<Id, number>> }
export const PANE_RESIZE_STEP = 24
const DEFAULT_HEIGHT = 160
const MIN_HEIGHT = 40

/** Các section xếp dọc trong grid; mỗi section có header bấm được và separator resize bằng pointer/phím. */
export function PaneStack<Id extends string = string>({ sections, state, onToggle, onResize }: {
  sections: PaneSection<Id>[]
  state: PaneStackState<Id>
  onToggle: (id: Id) => void
  onResize: (id: Id, height: number) => void
}) {
  const drag = useRef<{ id: Id; y: number; height: number } | null>(null)
  const bodies = useRef<Partial<Record<Id, HTMLElement | null>>>({})
  // Chưa resize thì body cao tự động: đọc chiều cao thật khi bắt đầu tương tác, không áp fallback 160px.
  const shownHeight = (id: Id, fallback: number) => {
    const measured = bodies.current[id]?.getBoundingClientRect().height ?? 0
    return measured > 0 ? measured : fallback
  }
  return (
    <div className="pane-stack">
      {sections.map(({ id, title, actions, children }) => {
        const collapsed = !!state.collapsed[id]
        const height = state.heights[id] ?? DEFAULT_HEIGHT
        const label = tr(collapsed ? 'Mở rộng {section}' : 'Thu gọn {section}', { section: tr(title) })
        return (
          <section key={id} className="pane-section" aria-label={tr(title)} data-collapsed={collapsed || undefined}
            style={{ '--pane-height': state.heights[id] === undefined ? undefined : `${height}px` } as CSSProperties}>
            <div className="pane-head">
              <button type="button" className="pane-toggle" aria-expanded={!collapsed} aria-label={label} title={label} onClick={() => onToggle(id)}>
                <span className={collapsed ? undefined : 'pane-collapse-open'}><Icon name="chevron" size={13} /></span>
                <h3>{tr(title)}</h3>
              </button>
              <div className="pane-actions">{actions}</div>
            </div>
            {!collapsed && <>
              <div className="pane-body" ref={(el) => { bodies.current[id] = el }}>{children}</div>
              <div className="pane-resize" role="separator" aria-orientation="horizontal" aria-label={tr('Chiều cao {section}', { section: tr(title) })}
                aria-valuenow={state.heights[id]} aria-valuemin={MIN_HEIGHT} tabIndex={0}
                onPointerDown={(event) => { drag.current = { id, y: event.clientY, height: shownHeight(id, height) }; event.currentTarget.setPointerCapture?.(event.pointerId); event.currentTarget.focus() }}
                onPointerMove={(event) => { if (drag.current?.id === id) onResize(id, Math.max(MIN_HEIGHT, drag.current.height + drag.current.y - event.clientY)) }}
                onPointerUp={() => { drag.current = null }}
                onPointerCancel={() => { drag.current = null }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                  event.preventDefault()
                  onResize(id, Math.max(MIN_HEIGHT, shownHeight(id, height) + (event.key === 'ArrowUp' ? PANE_RESIZE_STEP : -PANE_RESIZE_STEP)))
                }} />
            </>}
          </section>
        )
      })}
    </div>
  )
}
