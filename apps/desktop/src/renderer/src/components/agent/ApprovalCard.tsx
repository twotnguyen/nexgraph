import { useEffect, useRef } from 'react'
import type { ApprovalRequest } from '@shared/agent-types'
import { createDiffEditor, languageFor } from '../editor/monaco'
import { vi } from '../../strings'

interface Props {
  request: ApprovalRequest
  onDecide: (allow: boolean) => void
}

const title = (r: ApprovalRequest): string =>
  r.tool === 'bash' ? `${vi.agent.bash}: ${r.command ?? ''}` : r.tool === 'write' ? vi.agent.writePath(r.path ?? '') : vi.agent.editPath(r.path ?? '')

/** Một yêu cầu duyệt: bash hiện nguyên lệnh, edit/write hiện diff chỉ đọc trước/sau. */
export function ApprovalCard({ request, onDecide }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const isDiff = request.tool !== 'bash'
  useEffect(() => {
    if (!isDiff || !host.current) return
    const diff = createDiffEditor(host.current, {
      before: request.before ?? '', after: request.after ?? '', language: languageFor(request.path ?? 'a.txt')
    })
    return () => diff.dispose()
  }, [request, isDiff])
  return (
    <div className="approval" aria-label={title(request)}>
      <p className="mono">{title(request)}</p>
      {isDiff && <div ref={host} className="approval-diff" />}
      <div className="row">
        <button type="button" className="primary" onClick={() => onDecide(true)}>{vi.agent.approve}</button>
        <button type="button" onClick={() => onDecide(false)}>{vi.agent.reject}</button>
      </div>
    </div>
  )
}
