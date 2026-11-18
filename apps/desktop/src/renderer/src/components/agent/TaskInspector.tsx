import { useEffect, useRef, useState } from 'react'
import { createDiffEditor, languageFor } from '../editor/monaco'
import type { AgentInspection } from './useAgentWorkbench'

export function TaskInspector({ inspection }: { inspection: AgentInspection }) {
  const element = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState('')
  const diff = inspection.before !== undefined && inspection.after !== undefined
  useEffect(() => {
    if (!element.current || !diff) return
    const editor = createDiffEditor(element.current, { before: inspection.before!, after: inspection.after!, language: languageFor(inspection.file ?? '') })
    return () => editor.dispose()
  }, [inspection, diff])
  return <section className="agent-inspector" aria-label={inspection.title}>
    <header><strong>{inspection.title}</strong><span role="status">{copied}</span><button type="button" onClick={() => {
      void navigator.clipboard.writeText(diff ? inspection.after! : inspection.text ?? '').then(() => setCopied('Đã sao chép')).catch(() => setCopied('Không truy cập được clipboard'))
    }}>Sao chép</button></header>
    {diff ? <div ref={element} className="agent-inspector-diff" /> : <pre tabIndex={0}>{inspection.text}</pre>}
  </section>
}
