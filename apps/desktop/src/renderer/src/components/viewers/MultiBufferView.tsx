import { tr } from '../../strings'
import { EditorTab } from '../editor/EditorTab'
import type { MultiBufferRequest } from '../../state/multiBuffer'

interface Props {
  projectId: string
  request: MultiBufferRequest
  active?: boolean
  onClose?: () => void
  onDirtyChange?: (file: string, dirty: boolean) => void
  onOpenFile?: (file: string, line: number) => void
}

/** Một thẻ gồm nhiều đoạn mã: mỗi đoạn là một EditorTab gắn đúng đường dẫn tệp gốc. */
export function MultiBufferView({ projectId, request, active = true, onClose, onDirtyChange, onOpenFile }: Props) {
  return (
    <div className="multi-buffer" style={{ position: 'absolute', inset: 0, display: active ? 'flex' : 'none', flexDirection: 'column', overflow: 'auto' }}>
      {request.excerpts.map((excerpt) => {
        const location = `${excerpt.file}:${excerpt.startLine}`
        const range = `${location}-${excerpt.endLine}`
        return (
          <section key={excerpt.id} aria-label={range} className="multi-buffer-excerpt"
            style={{ position: 'relative', flex: '0 0 280px', minHeight: 0, borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
            <button type="button" className="multi-buffer-head mono" aria-label={location} title={range} onClick={() => onOpenFile?.(excerpt.file, excerpt.startLine)}
              style={{ position: 'sticky', top: 0, zIndex: 1, width: '100%', height: 24, display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 11, textAlign: 'left', border: 0, borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'inherit', cursor: 'pointer' }}>
              {location} <small style={{ marginLeft: 8, opacity: 0.7 }}>{excerpt.label ?? tr('dòng {from}–{to}', { from: excerpt.startLine, to: excerpt.endLine })}</small>
            </button>
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
