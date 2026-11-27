import { useEffect, useRef } from 'react'
import type { ApprovalRequest, FileApprovalRequest } from '@nexgraph/contracts/agent-types'
import { createDiffEditor, languageFor } from '../editor/monaco'
import { tr, vi } from '../../i18n/strings'
import './approval-card.css'

interface Props {
  request: ApprovalRequest
  disabled?: boolean
  onDecide: (allow: boolean) => void
  onInspect?: (request: FileApprovalRequest) => void
}

const isFile = (request: ApprovalRequest): request is FileApprovalRequest => request.tool === 'edit' || request.tool === 'write'

function titleOf(request: ApprovalRequest): string {
  switch (request.tool) {
    case 'command': return tr('Chạy lệnh trong dự án')
    case 'webfetch': return tr('Mở trang web')
    case 'websearch': return tr('Tìm trên web')
    case 'write': return vi.agent.writePath(request.path)
    case 'edit': return vi.agent.editPath(request.path)
  }
}

function approveLabel(request: ApprovalRequest): string {
  if (request.tool === 'command') return tr('Cho phép chạy')
  if (request.tool === 'webfetch' || request.tool === 'websearch') return tr('Cho phép')
  return vi.agent.approve
}

/** Mỗi thẻ cho duyệt một thao tác: diff chỉ đọc của một tệp, một lệnh, hoặc một URL/câu tìm web. */
export function ApprovalCard({ request, disabled, onDecide, onInspect }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const title = titleOf(request)
  useEffect(() => {
    if (!host.current || !isFile(request)) return
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
            <dt>{tr('Thư mục chạy')}</dt><dd><code>{request.cwd}</code></dd>
            <dt>{tr('Thời gian tối đa')}</dt><dd>{tr('{seconds} giây', { seconds: Math.ceil(request.timeoutMs / 1000) })}</dd>
          </dl>
        </div>
      ) : request.tool === 'webfetch' || request.tool === 'websearch' ? (
        // Văn bản thuần, không phải link: người dùng đọc kỹ URL/câu tìm trước khi cho dữ liệu đi ra ngoài.
        <div className="approval-command"><pre><code>{request.target}</code></pre></div>
      ) : <div ref={host} className="approval-diff" />}
      <div className="row">
        {isFile(request) && onInspect && <button type="button" onClick={() => onInspect(request)}>{tr('Xem diff ở giữa')}</button>}
        <button type="button" className="primary" disabled={disabled} onClick={() => onDecide(true)}>{approveLabel(request)}</button>
        <button type="button" disabled={disabled} onClick={() => onDecide(false)}>{vi.agent.reject}</button>
      </div>
    </div>
  )
}
