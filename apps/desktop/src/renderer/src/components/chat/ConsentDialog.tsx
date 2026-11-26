import type { AiConsentTarget } from '@nexgraph/contracts/agent-types'
import { tr, vi } from '../../strings'

export function ConsentDialog({ project, target, model, onOk, onCancel }: {
  project: string; target: AiConsentTarget; model: string; onOk: () => void; onCancel: () => void
}) {
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={vi.chat.consentTitle} className="modal">
        <h2>{vi.chat.consentTitle}</h2>
        <p>{target.runtime === 'antigravity-cli'
          ? tr('Cho phép Antigravity CLI chính thức gửi ngữ cảnh và lịch sử hội thoại của dự án “{project}” tới Google bằng tài khoản Google hiện đang được Antigravity quản lý trên máy này? Trợ lý sử dụng {model}.', { project, model: model === 'auto' ? tr('model được chọn tự động') : model })
          : target.runtime === 'nex' && target.baseUrl.startsWith('nex-account:')
            ? tr('Câu hỏi, ngữ cảnh đồ thị và nội dung tệp mà trợ lý đọc trong dự án {project} có thể được gửi tới tài khoản {provider} đã đăng nhập trong Nex (model {model}). Nex gửi bằng tài khoản đó, không qua khoá API của NexGraph.', { project, provider: target.provider, model })
            : vi.chat.consentBody(project, target.provider, target.baseUrl, model)}</p>
        {target.runtime === 'antigravity-cli' && <p className="muted small">{tr('Nếu bạn đổi tài khoản Google ngoài NexGraph, hãy ngắt kết nối NexGraph rồi kết nối lại trước khi tiếp tục.')}</p>}
        <div className="row">
          <button type="button" className="primary" onClick={onOk}>{vi.chat.consentOk}</button>
          <button type="button" onClick={onCancel}>{vi.chat.consentCancel}</button>
        </div>
      </div>
    </div>
  )
}
