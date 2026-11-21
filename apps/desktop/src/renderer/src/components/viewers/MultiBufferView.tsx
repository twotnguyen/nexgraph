import { EditorTab } from '../editor/EditorTab'
import type { MultiBufferRequest } from '../../state/multiBuffer'

interface Props {
  projectId: string
  request: MultiBufferRequest
  active?: boolean
  onClose?: () => void
  onDirtyChange?: (file: string, dirty: boolean) => void
}

/** Một thẻ gồm nhiều đoạn mã: mỗi đoạn là một EditorTab gắn đúng đường dẫn tệp gốc. */
export function MultiBufferView({ projectId, request, active = true, onClose, onDirtyChange }: Props) {
  return (
    <div className="multi-buffer" style={{ position: 'absolute', inset: 0, display: active ? 'flex' : 'none', flexDirection: 'column', overflow: 'auto' }}>
      {request.excerpts.map((excerpt) => {
        const range = `${excerpt.file}:${excerpt.startLine}-${excerpt.endLine}`
        return (
          <section key={excerpt.id} aria-label={range} className="multi-buffer-excerpt"
            style={{ position: 'relative', flex: '0 0 280px', minHeight: 0, borderBottom: '1px solid var(--color-border)' }}>
            <div className="multi-buffer-head mono" title={range} style={{ height: 24, display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 11, borderBottom: '1px solid var(--color-border)' }}>
              {excerpt.label ?? range}
            </div>
            <div style={{ position: 'absolute', top: 24, right: 0, bottom: 0, left: 0 }}>
              <EditorTab projectId={projectId} file={excerpt.file} line={excerpt.startLine} lineEnd={excerpt.endLine}
                active={active} onClose={() => onClose?.()} onDirtyChange={onDirtyChange ?? (() => {})} />
            </div>
          </section>
        )
      })}
    </div>
  )
}
