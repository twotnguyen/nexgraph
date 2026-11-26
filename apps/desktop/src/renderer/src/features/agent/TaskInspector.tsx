import { useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n/strings'
import { msg, msgText, type Message } from '../../shared/lib/messages'
import { createDiffEditor, languageFor } from '../editor/monaco'
import type { AgentInspection } from './useAgentWorkbench'

export function TaskInspector({ inspection }: { inspection: AgentInspection }) {
  const element = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<Message>('')
  const diff = inspection.before !== undefined && inspection.after !== undefined
  useEffect(() => {
    if (!element.current || !diff) return
    const editor = createDiffEditor(element.current, { before: inspection.before!, after: inspection.after!, language: languageFor(inspection.file ?? '') })
    return () => editor.dispose()
  }, [inspection, diff])
  return <section className="agent-inspector" aria-label={inspection.title}>
    <header><strong>{inspection.title}</strong><span role="status">{msgText(copied)}</span><button type="button" onClick={() => {
      void navigator.clipboard.writeText(diff ? inspection.after! : inspection.text ?? '').then(() => setCopied(msg('Đã sao chép'))).catch(() => setCopied(msg('Không truy cập được clipboard')))
    }}>{tr('Sao chép')}</button></header>
    {diff ? <div ref={element} className="agent-inspector-diff" /> : <pre tabIndex={0}>{inspection.text}</pre>}
  </section>
}
