import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [selectedId, setSelectedId] = useState<number | null>(initialFlowId ?? null)
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [codeSlice, setCodeSlice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FlowKind | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // Tải danh sách luồng
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await window.nexgraph.graph.flows(projectId, { q: query || undefined, kind, limit: 50 })
        if (!alive) return
        setList(res)
        if (selectedId == null && initialFlowId == null && res.flows.length > 0) {
          // Chưa chọn luồng nào: giữ nguyên để hiện lời nhắc
        }
      } catch (err) {
        if (alive) setError(errMessage(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [projectId, query, kind])

  // Tải chi tiết luồng khi chọn
  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
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

  return (
    <div className="flows-view">
      {error && <p role="alert" className="error" style={{ gridColumn: '1 / -1', margin: 8 }}>{error}</p>}
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
