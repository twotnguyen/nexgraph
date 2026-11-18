import type { AiConsentTarget } from '@shared/agent-types'
import { vi } from '../../strings'

export function ConsentDialog({ project, target, model, onOk, onCancel }: {
  project: string; target: AiConsentTarget; model: string; onOk: () => void; onCancel: () => void
}) {
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={vi.chat.consentTitle} className="modal">
        <h2>{vi.chat.consentTitle}</h2>
        <p>{vi.chat.consentBody(project, target.provider, target.baseUrl, model)}</p>
        <div className="row">
          <button type="button" className="primary" onClick={onOk}>{vi.chat.consentOk}</button>
          <button type="button" onClick={onCancel}>{vi.chat.consentCancel}</button>
        </div>
      </div>
    </div>
  )
}
