import type { FlowStep } from '@nexgraph/contracts/graph-types'
import { tr, vi } from '../../i18n/strings'

interface Props {
  steps: FlowStep[]
  currentIndex: number
  onSelectStep: (index: number) => void
  onOpenCode: (file: string, line: number, lineEnd?: number) => void
  onOpenNode: (nodeId: string) => void
  codeSlice?: string | null
  /** CodeSlice.truncated: engine chỉ trả phần đầu của tệp dài. */
  codeTruncated?: boolean
}

export function FlowStepPanel({
  steps,
  currentIndex,
  onSelectStep,
  onOpenCode,
  onOpenNode,
  codeSlice,
  codeTruncated
}: Props) {
  const currentStep = steps[currentIndex]
  const node = currentStep?.node

  const handleOpenCode = () => {
    if (node?.file && node.line_start != null) {
      onOpenCode(node.file, node.line_start, node.line_end ?? undefined)
    }
  }

  const handleOpenNode = () => {
    if (node) {
      onOpenNode(node.id)
    }
  }

  return (
    <aside className="step-panel-col">
      <div className="step-list-header">
        {tr('Các bước trong luồng ({count})', { count: steps.length })}
      </div>

      <div className="step-list">
        {steps.map((s, idx) => {
          const isCurrent = idx === currentIndex
          const indent = Math.min(s.depth * 12, 60)
          return (
            <div
              key={`${s.order}-${s.node.id}`}
              role="button"
              tabIndex={0}
              className={`step-row ${isCurrent ? 'current' : ''}`}
              style={{ paddingLeft: `${8 + indent}px` }}
              onClick={() => onSelectStep(idx)}
              onKeyDown={(e) => e.key === 'Enter' && onSelectStep(idx)}
              aria-pressed={isCurrent}
            >
              <span className="step-num">{idx + 1}</span>
              <span className="step-name">{s.node.label}</span>
            </div>
          )
        })}
      </div>

      {node && (
        <div className="step-detail-card">
          <div className="detail-node-name">{node.label}</div>
          {node.file && (
            <div className="detail-location">
              {node.file}:{node.line_start ?? 1}
              {node.line_end && node.line_end !== node.line_start ? `–${node.line_end}` : ''}
            </div>
          )}
          {currentStep.caller && currentStep.line != null && (
            <div className="muted small">
              {vi.flows.calledFrom(currentStep.caller.split('::').pop()?.split('#')[0] ?? currentStep.caller, currentStep.line)}
            </div>
          )}
          {codeSlice && (
            <pre className="detail-code">
              <code>{codeSlice}</code>
            </pre>
          )}
          {codeTruncated && <p role="status" className="muted small">{vi.code.truncated}</p>}
          <div className="detail-actions">
            <button
              type="button"
              className="btn-action"
              onClick={handleOpenCode}
              disabled={!node.file}
            >
              {vi.flows.openFile}
            </button>
            <button
              type="button"
              className="btn-action"
              onClick={handleOpenNode}
            >
              {vi.flows.showInGraph}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
