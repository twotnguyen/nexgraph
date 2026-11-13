import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowDetail, FlowKind, FlowList as FlowListType, GraphEdge } from '@shared/graph-types'
import type { HighlightKind } from '../graph/kindStyle'
import { vi } from '../../strings'
import { GraphCanvas } from '../graph/GraphCanvas'
import { FlowList } from './FlowList'
import { FlowPlayer } from './FlowPlayer'
import { FlowStepPanel } from './FlowStepPanel'

interface Props {
  projectId: string
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onOpenNode: (nodeId: string) => void
  initialFlowId?: number
}

const errMessage = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err)

export function FlowsView({ projectId, onOpenCode, onOpenNode, initialFlowId }: Props) {
  const [list, setList] = useState<FlowListType>({ flows: [], total: 0, truncated: false })
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(initialFlowId ?? null)
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [codeSlice, setCodeSlice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FlowKind | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const listRequest = useRef(0)
  const loadingMore = useRef(false)

  const resetList = useCallback(() => {
    listRequest.current += 1
    loadingMore.current = false
    setList({ flows: [], total: 0, truncated: false })
    setOffset(0)
  }, [])

  useEffect(() => {
    setSelectedId(initialFlowId ?? null)
  }, [initialFlowId])

  useEffect(() => {
    resetList()
  }, [projectId, resetList])

  // Tải danh sách luồng
  useEffect(() => {
    let alive = true
    const request = ++listRequest.current
    const opts = { q: query || undefined, kind, limit: 50, ...(offset > 0 ? { offset } : {}) }
    ;(async () => {
      try {
        const res = await window.nexgraph.graph.flows(projectId, opts)
        if (!alive || request !== listRequest.current) return
        setList((current) => offset === 0
          ? res
          : { ...res, flows: [...current.flows, ...res.flows] })
      } catch (err) {
        if (alive && request === listRequest.current) setError(errMessage(err))
      } finally {
        if (request === listRequest.current) loadingMore.current = false
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, query, kind, offset])

  // Tải chi tiết luồng khi chọn
  useEffect(() => {
    setDetail(null)
    setCodeSlice(null)
    if (selectedId == null) {
      return
    }
    let alive = true
    ;(async () => {
      try {
        setError(null)
        const d = await window.nexgraph.graph.flow(projectId, selectedId)
        if (!alive) return
        setDetail(d)
        setStepIndex(0)
      } catch (err) {
        if (alive) setError(errMessage(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, selectedId])

  // Tải đoạn mã khi chuyển bước
  useEffect(() => {
    const step = detail?.steps[stepIndex]
    const node = step?.node
    if (!node?.file || node.line_start == null) {
      setCodeSlice(null)
      return
    }
    let alive = true
    const start = Math.max(1, node.line_start - 2)
    const end = Math.min(start + 40, node.line_end ?? start + 20)
    ;(async () => {
      try {
        const slice = await window.nexgraph.graph.code(projectId, node.file!, start, end)
        if (alive) setCodeSlice(slice.text)
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
    const nodes = detail.steps.map((s) => s.node)
    const edges: GraphEdge[] = []
    detail.steps.forEach((s, idx) => {
      if (s.caller && s.line != null) {
        edges.push({
          id: idx,
          source: s.caller,
          target: s.node.id,
          type: 'CALLS',
          subtype: null,
          confidence: 'EXTRACTED',
          confidence_score: 1.0,
          origin: 'ast',
          evidence: {
            file: s.node.file ?? '',
            line: s.line,
            col: 0
          }
        })
      }
    })
    return { nodes, edges }
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

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    resetList()
  }, [resetList])

  const handleKindChange = useCallback((value?: FlowKind) => {
    setKind(value)
    resetList()
  }, [resetList])

  const loadMore = useCallback(() => {
    if (!list.truncated || loadingMore.current) return
    loadingMore.current = true
    setOffset(list.flows.length)
  }, [list])

  return (
    <div className="flows-view">
      {error && <p role="alert" className="error" style={{ gridColumn: '1 / -1', margin: 8 }}>{error}</p>}
      <FlowList
        flows={list.flows}
        total={list.total}
        selectedId={selectedId}
        onSelect={handleSelectFlow}
        query={query}
        onQueryChange={handleQueryChange}
        currentKind={kind}
        onKindChange={handleKindChange}
        truncated={list.truncated}
        onLoadMore={loadMore}
      />

      <section className="canvas-col">
        {!detail ? (
          <div className="canvas-area center muted" style={{ display: 'grid', placeItems: 'center' }}>
            <p>{vi.flows.pick}</p>
          </div>
        ) : (
          <>
            <div className="canvas-area" style={{ flex: 1, minHeight: 0 }}>
              <GraphCanvas
                projectId={projectId}
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
        />
      )}
    </div>
  )
}
