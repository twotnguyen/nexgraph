import { useSyncExternalStore } from 'react'
import type { LspDiagnostic } from '@shared/api'

type DiagnosticEvent = { projectId: string; file: string; diagnostics: LspDiagnostic[] }
const empty: Record<string, LspDiagnostic[]> = {}
const emptyFile: LspDiagnostic[] = []
const projects = new Map<string, Record<string, LspDiagnostic[]>>()
const listeners = new Set<() => void>()
const eventListeners = new Set<(event: DiagnosticEvent) => void>()
let off: (() => void) | undefined
let mounts = 0

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function subscribeDiagnostics(listener: (event: DiagnosticEvent) => void): () => void {
  eventListeners.add(listener)
  const stop = startDiagnostics()
  return () => { eventListeners.delete(listener); stop() }
}

export function getDiagnostics(projectId: string, file: string): LspDiagnostic[] {
  return projects.get(projectId)?.[file] ?? emptyFile
}

export function useDiagnostics(projectId: string): Record<string, LspDiagnostic[]> {
  return useSyncExternalStore(subscribe, () => projects.get(projectId) ?? empty, () => empty)
}

/** Gắn trước khi editor mở language server. */
export function startDiagnostics(): () => void {
  mounts++
  if (!off) off = window.nexgraph?.lsp?.onDiagnostics?.((event) => {
    projects.set(event.projectId, { ...(projects.get(event.projectId) ?? empty), [event.file]: event.diagnostics })
    for (const listener of eventListeners) listener(event)
    for (const listener of listeners) listener()
  })
  return () => {
    if (--mounts === 0) { off?.(); off = undefined }
  }
}

/** Gửi lại tài liệu cho language server để lấy diagnostic mới (chưa có API refresh/stop riêng). */
export async function refreshDiagnostics(projectId: string): Promise<void> {
  const api = window.nexgraph
  if (!api?.lsp?.open) return
  for (const file of Object.keys(projects.get(projectId) ?? empty)) {
    try {
      // shortcut: đọc từ đĩa, không lấy buffer chưa lưu của editor.
      const content = await api.fs?.read(projectId, file)
      if (!content) continue
      await api.lsp.close?.(projectId, file)
      await api.lsp.open(projectId, file, content.text)
    } catch { /* tệp có thể đã bị xoá hoặc nằm ngoài dự án */ }
  }
}
