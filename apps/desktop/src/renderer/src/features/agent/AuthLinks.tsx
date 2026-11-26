import { tr } from '../../i18n/strings'
import type { AuthEventView } from '@nexgraph/contracts/agent-types'

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

/** OAuth links stay actionable when the operating system did not focus the browser. */
export function AuthLinks({ event }: { event: AuthEventView | null }) {
  const links = event?.type === 'auth_url' ? [{ url: event.url }]
    : event?.type === 'device_code' ? [{ url: event.verificationUri }]
      : event?.type === 'info' ? event.links ?? [] : []
  return <>{links.map((link, index) => {
    const url = safeUrl(link.url)
    return url ? <p key={index}><a href={url} target="_blank" rel="noopener noreferrer">{tr('Mở lại trang xác nhận')}</a></p> : null
  })}</>
}
