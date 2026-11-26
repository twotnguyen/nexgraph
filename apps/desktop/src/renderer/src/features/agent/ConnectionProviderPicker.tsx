import { tr } from '../../i18n/strings'
import { Icon, type IconName } from '../../shared/ui/icons'

export type ConnectionProvider = 'gemini' | 'openai' | 'other' | 'nex' | 'local'

function providers(): { id: ConnectionProvider; title: string; description: string; icon: IconName }[] {
  return [
    { id: 'gemini', title: 'Gemini', description: tr('Tài khoản Google hoặc API key'), icon: 'spark' },
    { id: 'openai', title: 'ChatGPT / OpenAI', description: tr('Tài khoản hoặc API key'), icon: 'graph' },
    { id: 'nex', title: 'Nex', description: tr('Tài khoản AI cho trợ lý Nex'), icon: 'spark' },
    { id: 'other', title: tr('Nhà cung cấp khác'), description: tr('Claude, OpenRouter và hơn nữa'), icon: 'plug' },
    { id: 'local', title: 'Ollama', description: tr('Model chạy trên máy'), icon: 'folder' }
  ]
}

export function ConnectionProviderPicker({ value, disabled, onChange }: {
  value: ConnectionProvider
  disabled?: boolean
  onChange: (value: ConnectionProvider) => void
}) {
  return <div className="connection-provider-picker" role="group" aria-label={tr('Chọn nhà cung cấp AI')}>
    {providers().map((provider) => <button key={provider.id} type="button" className={`connection-provider-card connection-provider-${provider.id}`}
      aria-label={provider.title} aria-pressed={value === provider.id} disabled={disabled} onClick={() => onChange(provider.id)}>
      <span className="connection-provider-icon"><Icon name={provider.icon} size={21} /></span>
      <span><strong>{provider.title}</strong><small>{provider.description}</small></span>
      {value === provider.id && <span className="connection-provider-selected"><Icon name="check" size={13} /></span>}
    </button>)}
  </div>
}
