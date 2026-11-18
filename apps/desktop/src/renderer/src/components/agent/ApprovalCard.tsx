import { useEffect, useRef } from 'react'
import type { ApprovalRequest } from '@shared/agent-types'
import { createDiffEditor, languageFor } from '../editor/monaco'
import { vi } from '../../strings'

interface Props {
  request: ApprovalRequest
  disabled?: boolean
  onDecide: (allow: boolean) => void
}

/** Mỗi thẻ cho duyệt bản diff chỉ đọc của một tệp. */
export function ApprovalCard({ request, disabled, onDecide }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const title = request.tool === 'write' ? vi.agent.writePath(request.path) : vi.agent.editPath(request.path)
  useEffect(() => {
    if (!host.current) return
    const diff = createDiffEditor(host.current, {
      before: request.before, after: request.after, language: languageFor(request.path)
    })
    return () => diff.dispose()
  }, [request])
  return (
    <div className="approval" role="group" aria-label={title}>
      <p className="mono">{title}</p>
      <div ref={host} className="approval-diff" />
      <div className="row">
        <button type="button" className="primary" disabled={disabled} onClick={() => onDecide(true)}>{vi.agent.approve}</button>
        <button type="button" disabled={disabled} onClick={() => onDecide(false)}>{vi.agent.reject}</button>
      </div>
    </div>
  )
}
