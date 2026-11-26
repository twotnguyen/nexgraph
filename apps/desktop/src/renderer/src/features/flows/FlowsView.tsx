import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowDetail, FlowKind, FlowList as FlowListType, GraphEdge } from '@nexgraph/contracts/graph-types'
import type { HighlightKind } from '../graph/kindStyle'
import { tr, vi } from '../../i18n/strings'
import { useDebounced } from '../../shared/lib/useDebounced'
import { CanvasState } from '../../shared/ui/CanvasState'
import { errorMsg } from '../../shared/lib/errorText'
import { msgText, type Message } from '../../shared/lib/messages'
import { GraphCanvas } from '../graph/GraphCanvas'
import { FlowList } from './FlowList'
import { FlowPlayer } from './FlowPlayer'
import { FlowStepPanel } from './FlowStepPanel'

interface Props {
  projectId: string
  revision?: number
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onOpenNode: (nodeId: string) => void
  initialFlowId?: number
  /** Đổi mỗi lần nơi khác yêu cầu mở luồng, để mở lại cùng `initialFlowId` vẫn chọn lại nó. */
  openRequest?: number
  onSelectedFlowChange?: (id?: number) => void
}

export function FlowsView({ projectId, revision = 0, onOpenCode, onOpenNode, initialFlowId, openRequest, onSelectedFlowChange }: Props) {
  const [list, setList] = useState<FlowListType>({ flows: [], total: 0, truncated: false })
  const [page, setPage] = useState<{ key: string; offset: number } | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(initialFlowId ?? null)
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [codeSlice, setCodeSlice] = useState<string | null>(null)
  const [codeTruncated, setCodeTruncated] = useState(false)
  const [query, setQuery] = useState('')
  const filter = useDebounced(query.trim(), 180)
  const [kind, setKind] = useState<FlowKind | undefined>(undefined)
  const [listError, setListError] = useState<Message | null>(null)
  const [detailError, setDetailError] = useState<Message | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listRetry, setListRetry] = useState(0)
  const [detailRetry, setDetailRetry] = useState(0)
  const listRequest = useRef(0)
  const loadingMore = useRef(false)
  const listKey = JSON.stringify([projectId, revision, filter, kind])
  const offset = page?.key === listKey ? page.offset : 0

  useEffect(() => {
    onSelectedFlowChange?.(detail?.flow.id === selectedId ? selectedId ?? undefined : undefined)
  }, [detail, selectedId, onSelectedFlowChange])

  useEffect(() => {
    setPage((current) => current?.key === listKey ? current : null)
  }, [listKey])

  useEffect(() => {
    setSelectedId(initialFlowId ?? null)
  }, [initialFlowId, openRequest])

  // Tải danh sách luồng
  useEffect(() => {
    let alive = true
    const request = ++listRequest.current
    const opts = { q: filter || undefined, kind, limit: 50, ...(offset > 0 ? { offset } : {}) }
    setListLoading(true)
    setListError(null)
    if (offset === 0) {
      loadingMore.current = false
      setList({ flows: [], total: 0, truncated: false })
    }
    ;(async () => {
      try {
        const res = await window.nexgraph.graph.flows(projectId, opts)
        if (!alive || request !== listRequest.current) return
        setList((current) => offset === 0
          ? res
          : { ...res, flows: [...current.flows, ...res.flows] })
      } catch (err) {
        if (alive && request === listRequest.current) setListError(errorMsg(err))
      } finally {
        if (alive && request === listRequest.current) {
          loadingMore.current = false
          setListLoading(false)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, filter, kind, offset, revision, listRetry])

  // Tải chi tiết luồng khi chọn
  useEffect(() => {
    setDetail(null)
    setCodeSlice(null)
    setDetailError(null)
    setDetailLoading(selectedId != null)
    if (selectedId == null) {
      return
    }
    let alive = true
    ;(async () => {
      try {
        const d = await window.nexgraph.graph.flow(projectId, selectedId)
        if (!alive) return
        setDetail(d)
        setStepIndex(0)
      } catch (err) {
        if (alive) setDetailError(errorMsg(err))
      } finally {
        if (alive) setDetailLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, selectedId, revision, detailRetry])

  // Tải đoạn mã khi chuyển bước
  useEffect(() => {
    const step = detail?.steps[stepIndex]
    const node = step?.node
    setCodeSlice(null)
    setCodeTruncated(false)
    if (!node?.file || node.line_start == null) {
      return
    }
    let alive = true
    const start = Math.max(1, node.line_start - 2)
    const end = Math.min(start + 40, node.line_end ?? start + 20)
    ;(async () => {
      try {
        const slice = await window.nexgraph.graph.code(projectId, node.file!, start, end)
        if (alive) { setCodeSlice(slice.text); setCodeTruncated(slice.truncated === true) }
      } catch {
        if (alive) setCodeSlice(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, detail, stepIndex])

  // Tạo overlay và highlights cho GraphCanvas
  const overlay = useMemo(() => {
    if (!detail || detail.steps.length === 0) return null
    const nodesById = new Map(detail.steps.map((s) => [s.node.id, s.node]))
    const edges: GraphEdge[] = []
    detail.steps.forEach((s, idx) => {
      const caller = s.caller && nodesById.get(s.caller)
      if (caller && s.line != null) {
        edges.push({
          id: idx,
          source: caller.id,
          target: s.node.id,
          type: 'CALLS',
          subtype: null,
          confidence: 'EXTRACTED',
          confidence_score: 1.0,
          origin: 'ast',
          evidence: caller.file ? {
            file: caller.file,
            line: s.line,
            col: 0
          } : null
        })
      }
    })
    return { nodes: [...nodesById.values()], edges }
  }, [detail])

  const highlights = useMemo<Record<string, HighlightKind>>(() => {
    if (!detail) return {}
    const h: Record<string, HighlightKind> = {}
    detail.steps.forEach((s, idx) => {
      if (idx === stepIndex) {
        h[s.node.id] = 'current'
      } else if (idx < stepIndex) {
        h[s.node.id] = 'visited'
      }
    })
    return h
  }, [detail, stepIndex])

  const handleSelectFlow = useCallback((id: number) => {
    setSelectedId(id)
  }, [])

  const loadMore = useCallback(() => {
    if (!list.truncated || loadingMore.current || listLoading) return
    loadingMore.current = true
    setPage({ key: listKey, offset: list.flows.length })
  }, [list, listKey, listLoading])

  return (
    <div className="flows-view">
      <FlowList
        flows={list.flows}
        total={list.total}
        selectedId={selectedId}
        onSelect={handleSelectFlow}
        query={query}
        onQueryChange={setQuery}
        currentKind={kind}
        onKindChange={setKind}
        truncated={list.truncated}
        loading={listLoading || query.trim() !== filter}
        error={msgText(listError)}
        onRetry={() => setListRetry((n) => n + 1)}
        onLoadMore={loadMore}
      />

      <section className="canvas-col">
        {!detail ? (
          <div className="canvas-area">
            {detailLoading ? <CanvasState kind="loading" message={tr('Đang tải các bước…')} />
              : detailError ? <CanvasState kind="error" message={msgText(detailError)} onRetry={() => setDetailRetry((n) => n + 1)} />
                : <CanvasState kind="empty" message={vi.flows.pick} />}
          </div>
        ) : (
          <>
            <div className="canvas-area" style={{ flex: 1, minHeight: 0 }}>
              <GraphCanvas
                projectId={projectId}
                revision={revision}
                startNodeId={detail.flow.entry.id}
                focusNodeId={detail.steps[stepIndex]?.node.id}
                onSelect={(n) => {
                  const idx = detail.steps.findIndex((s) => s.node.id === n.id)
                  if (idx >= 0) setStepIndex(idx)
                }}
                overlay={overlay}
                highlights={highlights}
              />
            </div>
            <FlowPlayer
              count={detail.steps.length}
              index={stepIndex}
              onChange={setStepIndex}
            />
          </>
        )}
      </section>

      {detail && (
        <FlowStepPanel
          steps={detail.steps}
          currentIndex={stepIndex}
          onSelectStep={setStepIndex}
          onOpenCode={onOpenCode}
          onOpenNode={onOpenNode}
          codeSlice={codeSlice}
          codeTruncated={codeTruncated}
        />
      )}
    </div>
  )
}
