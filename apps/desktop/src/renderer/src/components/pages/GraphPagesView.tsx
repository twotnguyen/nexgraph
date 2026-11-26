// NG-UI-2: chế độ xem các trang HTML do pipeline đồ thị sinh ra trong `<root>/.nexgraph/`.
// Mỗi lúc chỉ giữ MỘT khung nhúng (spike A3: 3 trang cùng sống ~1 GB RAM).
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphPageSelection, GraphPagesStatus } from '@nexgraph/contracts/graph-pages'
import { GRAPH_PAGE_THEME_CHANNEL, canOpenPageSource, communityPageUrl, graphPageUrl } from '@nexgraph/contracts/graph-pages'
import { tr, vi } from '../../strings'
import { useLocale } from '../../state/locale'
import { useTheme } from '../../state/useTheme'
import './graph-pages.css'

type Mode = 'graph' | 'tree' | 'callflow'

interface Props {
  projectId: string
  status: GraphPagesStatus
  /** Tăng khi đồ thị được cập nhật: dựng lại khung nhúng để đọc tệp mới. */
  revision: number
  /** NG-ACT-1: mở tệp:dòng bằng lệnh mở tệp hiện có của app. */
  onOpenCode?: (file: string, line: number) => void
  /** NG-ACT-1: mở màn ảnh hưởng hiện có cho node. */
  onImpact?: (id: string) => void
  /** NG-ACT-1: điền câu hỏi kèm ngữ cảnh nút vào ô chat của agent (không tự gửi). */
  onAsk?: (text: string) => void
}

interface FrameElement extends HTMLElement {
  send?: (channel: string, ...args: unknown[]) => void
}

/** NG-ACT-1/3: câu hỏi gửi agent có đủ ngữ cảnh (nút + tệp:dòng, hoặc cộng đồng + số thành viên). */
const askText = (selection: GraphPageSelection): string => selection.memberCount !== null
  ? tr('Tóm tắt cộng đồng "{label}" ({count} thành phần) trong đồ thị này.', { label: selection.label, count: selection.memberCount })
  : selection.sourceLocation
    ? tr('Giải thích nút "{label}" ({source}) trong đồ thị này.', { label: selection.label, source: selection.sourceLocation })
    : tr('Giải thích nút "{label}" trong đồ thị này.', { label: selection.label })

export function GraphPagesView({ projectId, status, revision, onOpenCode, onImpact, onAsk }: Props) {
  const theme = useTheme()
  // Nhãn chế độ đọc qua `vi` (Proxy không tự phát lại): subscribe locale để đổi ngôn ngữ là đổi nhãn ngay.
  const locale = useLocale()
  const frameRef = useRef<FrameElement | null>(null)
  const [selection, setSelection] = useState<GraphPageSelection | null>(null)
  // NG-ACT-3: đang xem đồ thị thành viên của một cộng đồng (null = trang tổng).
  const [community, setCommunity] = useState<{ id: number; name: string } | null>(null)

  const modes = useMemo(() => [
    ...(status.graph ? [{ id: 'graph' as const, file: 'graph.html', label: vi.workspace.pagesGraph }] : []),
    ...(status.tree ? [{ id: 'tree' as const, file: 'GRAPH_TREE.html', label: vi.workspace.pagesTree }] : []),
    ...(status.callflow ? [{ id: 'callflow' as const, file: status.callflow, label: vi.workspace.pagesCallflow }] : [])
  ], [status.graph, status.tree, status.callflow, locale])

  const [page, setPage] = useState<Mode>(modes[0]?.id ?? 'graph')
  const active = modes.find((item) => item.id === page) ?? modes[0]

  // Đồ thị cập nhật hoặc đổi dự án: trang cũ có thể không còn — quay về chế độ còn tệp.
  useEffect(() => {
    if (!modes.some((item) => item.id === page) && modes[0]) setPage(modes[0].id)
  }, [modes, page])
  useEffect(() => { setSelection(null); setCommunity(null) }, [page, revision, projectId])

  const sendTheme = useCallback(() => {
    const frame = frameRef.current
    if (!frame?.send) return
    try {
      frame.send(GRAPH_PAGE_THEME_CHANNEL, theme)
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
  }, [sendTheme, page, revision, community?.id])

  // Panel nhỏ của app (NG-UI-3): nút vừa chọn trong trang + tệp:dòng từ engine.
  useEffect(() => {
    const api = window.nexgraph?.graphPages
    if (!api?.onNodeSelected) return
    return api.onNodeSelected((picked) => {
      if (picked.projectId === projectId) setSelection(picked)
    })
  }, [projectId])

  const selectionCanOpen = canOpenPageSource(selection?.sourceFile)

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
      {community && (
        <div className="graph-pages-community-bar">
          <button type="button" className="graph-pages-back" onClick={() => { setCommunity(null); setSelection(null) }}>
            {vi.workspace.pagesBackOverview}
          </button>
          <span className="graph-pages-community-name">{tr('Cộng đồng: {name}', { name: community.name })}</span>
        </div>
      )}
      <div className="graph-pages-body">
        {createElement('webview', {
          key: `${active.id}:${community?.id ?? ''}:${revision}`,
          ref: (element: FrameElement | null) => { frameRef.current = element },
          className: 'graph-pages-frame',
          src: community ? communityPageUrl(projectId, community.id) : graphPageUrl(projectId, active.file),
          partition: status.partition,
          preload: status.preload,
          webpreferences: 'sandbox=yes, contextIsolation=yes, nodeIntegration=no',
          title: community ? tr('Cộng đồng: {name}', { name: community.name }) : active.label
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
            <div className="graph-pages-actions" role="group" aria-label={vi.workspace.pagesActions}>
              <button type="button" className="graph-pages-action"
                disabled={!selectionCanOpen || !onOpenCode}
                title={selectionCanOpen ? undefined : vi.workspace.pagesOpenCodeDisabled}
                onClick={() => { if (selection.sourceFile && onOpenCode) onOpenCode(selection.sourceFile, selection.sourceLine ?? 1) }}>
                {vi.workspace.pagesOpenCode}
              </button>
              <button type="button" className="graph-pages-action" disabled={!onImpact || selection.memberCount !== null} onClick={() => onImpact?.(selection.id)}>
                {vi.workspace.pagesImpact}
              </button>
              <button type="button" className="graph-pages-action" disabled={!onAsk} onClick={() => onAsk?.(askText(selection))}>
                {vi.workspace.pagesAskNex}
              </button>
              {selection.memberCount !== null && (
                <button type="button" className="graph-pages-action graph-pages-open-community"
                  onClick={() => {
                    const id = selection.community ?? Number(selection.id)
                    if (!Number.isInteger(id) || id < 0) return
                    setCommunity({ id, name: selection.label })
                    setSelection(null)
                  }}>
                  {vi.workspace.pagesOpenCommunity}
                </button>
              )}
            </div>
            {selection.via && <p className="muted">{tr('Chọn qua {via}', { via: selection.via })}</p>}
          </aside>
        )}
      </div>
    </div>
  )
}
