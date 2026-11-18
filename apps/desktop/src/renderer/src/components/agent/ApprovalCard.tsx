import { useEffect, useRef } from 'react'
import type { ApprovalRequest, FileApprovalRequest } from '@shared/agent-types'
import { createDiffEditor, languageFor } from '../editor/monaco'
import { vi } from '../../strings'
import './approval-card.css'

interface Props {
  request: ApprovalRequest
  disabled?: boolean
  onDecide: (allow: boolean) => void
  onInspect?: (request: FileApprovalRequest) => void
}

/** Mỗi thẻ cho duyệt bản diff chỉ đọc của một tệp. */
export function ApprovalCard({ request, disabled, onDecide, onInspect }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const title = request.tool === 'command' ? 'Chạy lệnh trong dự án'
    : request.tool === 'write' ? vi.agent.writePath(request.path) : vi.agent.editPath(request.path)
  useEffect(() => {
    if (!host.current || request.tool === 'command') return
    const diff = createDiffEditor(host.current, {
      before: request.before, after: request.after, language: languageFor(request.path)
    })
    return () => diff.dispose()
  }, [request])
  return (
    <div className="approval" role="group" aria-label={title}>
      <p className="mono">{title}</p>
      {request.tool === 'command' ? (
        <div className="approval-command">
          <pre><code>{[request.executable, ...request.args.map((arg) => JSON.stringify(arg))].join(' ')}</code></pre>
          <dl>
            <dt>Thư mục chạy</dt><dd><code>{request.cwd}</code></dd>
            <dt>Thời gian tối đa</dt><dd>{Math.ceil(request.timeoutMs / 1000)} giây</dd>
          </dl>
        </div>
      ) : <div ref={host} className="approval-diff" />}
      <div className="row">
        {request.tool !== 'command' && onInspect && <button type="button" onClick={() => onInspect(request)}>Xem diff ở giữa</button>}
        <button type="button" className="primary" disabled={disabled} onClick={() => onDecide(true)}>{request.tool === 'command' ? 'Cho phép chạy' : vi.agent.approve}</button>
        <button type="button" disabled={disabled} onClick={() => onDecide(false)}>{vi.agent.reject}</button>
      </div>
    </div>
  )
}
