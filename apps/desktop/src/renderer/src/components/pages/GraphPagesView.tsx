// NG-UI-2: chế độ xem các trang HTML do pipeline đồ thị sinh ra trong `<root>/.nexgraph/`.
// Mỗi lúc chỉ giữ MỘT khung nhúng (spike A3: 3 trang cùng sống ~1 GB RAM).
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphPageSelection, GraphPagesStatus } from '@shared/graph-pages'
import { graphPageUrl } from '@shared/graph-pages'
import { tr, vi } from '../../strings'
import { useTheme } from '../../state/useTheme'
import './graph-pages.css'

type Mode = 'graph' | 'tree' | 'callflow'

interface Props {
  projectId: string
  status: GraphPagesStatus
  /** Tăng khi đồ thị được cập nhật: dựng lại khung nhúng để đọc tệp mới. */
  revision: number
}

interface FrameElement extends HTMLElement {
  send?: (channel: string, ...args: unknown[]) => void
}

const THEME_CHANNEL = 'nxpage:theme'

export function GraphPagesView({ projectId, status, revision }: Props) {
  const theme = useTheme()
  const frameRef = useRef<FrameElement | null>(null)
  const [selection, setSelection] = useState<GraphPageSelection | null>(null)

  const modes = useMemo(() => [
    ...(status.graph ? [{ id: 'graph' as const, file: 'graph.html', label: vi.workspace.pagesGraph }] : []),
    ...(status.tree ? [{ id: 'tree' as const, file: 'GRAPH_TREE.html', label: vi.workspace.pagesTree }] : []),
    ...(status.callflow ? [{ id: 'callflow' as const, file: status.callflow, label: vi.workspace.pagesCallflow }] : [])
  ], [status.graph, status.tree, status.callflow])

  const [page, setPage] = useState<Mode>(modes[0]?.id ?? 'graph')
  const active = modes.find((item) => item.id === page) ?? modes[0]

  // Đồ thị cập nhật hoặc đổi dự án: trang cũ có thể không còn — quay về chế độ còn tệp.
  useEffect(() => {
    if (!modes.some((item) => item.id === page) && modes[0]) setPage(modes[0].id)
  }, [modes, page])
  useEffect(() => { setSelection(null) }, [page, revision, projectId])

  const sendTheme = useCallback(() => {
    const frame = frameRef.current
    if (!frame?.send) return
    try {
      frame.send(THEME_CHANNEL, theme)
    } catch {
      // Khung chưa dom-ready: sự kiện dom-ready sẽ gửi lại.
    }
  }, [theme])
  useEffect(() => { sendTheme() }, [sendTheme])
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onReady = () => sendTheme()
    frame.addEventListener('dom-ready', onReady)
    return () => frame.removeEventListener('dom-ready', onReady)
  }, [sendTheme, page, revision])

  // Panel nhỏ của app (NG-UI-3): nút vừa chọn trong trang + tệp:dòng từ engine.
  useEffect(() => {
    const api = window.nexgraph?.graphPages
    if (!api?.onNodeSelected) return
    return api.onNodeSelected((picked) => {
      if (picked.projectId === projectId) setSelection(picked)
    })
  }, [projectId])

  if (!active) return null
  return (
    <div className="graph-pages">
      <div className="graph-pages-modes" role="tablist" aria-label={vi.workspace.pagesModes}>
        {modes.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === active.id}
            className={`graph-pages-mode${item.id === active.id ? ' active' : ''}`} onClick={() => setPage(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="graph-pages-body">
        {createElement('webview', {
          key: `${active.id}:${revision}`,
          ref: (element: FrameElement | null) => { frameRef.current = element },
          className: 'graph-pages-frame',
          src: graphPageUrl(projectId, active.file),
          partition: status.partition,
          preload: status.preload,
          webpreferences: 'sandbox=yes, contextIsolation=yes, nodeIntegration=no',
          title: active.label
        })}
        {selection && (
          <aside role="status" aria-label={vi.workspace.pagesSelection} className="graph-pages-selection">
            <div className="graph-pages-selection-head">
              <strong>{selection.label}</strong>
              <button type="button" aria-label={vi.workspace.pagesCloseSelection} title={vi.workspace.pagesCloseSelection}
                onClick={() => setSelection(null)}>×</button>
            </div>
            <dl>
              <dt>{vi.workspace.pagesId}</dt>
              <dd className="mono">{selection.id}</dd>
              <dt>{vi.workspace.pagesSource}</dt>
              <dd className="mono">{selection.sourceLocation ?? vi.workspace.pagesNoSource}</dd>
            </dl>
            {selection.via && <p className="muted">{tr('Chọn qua {via}', { via: selection.via })}</p>}
          </aside>
        )}
      </div>
    </div>
  )
}
